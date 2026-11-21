import { spawn, type ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import { createInterface } from "node:readline";
import { PassThrough } from "node:stream";

/**
 * Folder sizes on Windows, fast. Node can only learn a file's size by opening
 * it, which on Windows costs about 30 µs a file and makes Defender look at
 * each one. Windows can list a folder with every entry's space on disk and
 * file id (GetFileInformationByHandleEx, FileIdExtdDirectoryInfo), and that
 * is what this does, from one PowerShell process kept for the whole run, with
 * a few threads per folder: several times faster than windu.js, which is used
 * instead where PowerShell cannot compile code (a locked-down computer).
 *
 * Its answers are what `du -k` prints, so the scan reads them the same way,
 * and like du it counts a hard-linked file once (Edge's versions share most
 * of their files that way).
 */
const SOURCE = String.raw`
using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;

public static class FixStorageDu {
  [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
  static extern IntPtr CreateFileW(string path, uint access, uint share, IntPtr security, uint disposition, uint flags, IntPtr template);
  [DllImport("kernel32.dll", SetLastError = true)]
  static extern bool GetFileInformationByHandleEx(IntPtr handle, int infoClass, IntPtr buffer, uint size);
  [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);

  const uint ListDirectory = 1, ShareAll = 7, OpenExisting = 3, BackupSemantics = 0x02000000;
  // FileIdExtdDirectoryRestartInfo, then FileIdExtdDirectoryInfo for the rest. The
  // FileIdBoth classes also make up 8.3 short names, which took 44 s in WinSxS.
  const int RestartListing = 20, ContinueListing = 19;
  const int AccessDenied = 5;
  const uint Directory = 0x10, ReparsePoint = 0x400;
  const int Threads = 4, BufferSize = 64 * 1024;

  static readonly object writing = new object();
  static Stream output;
  static readonly ConcurrentDictionary<string, CancellationTokenSource> running = new ConcurrentDictionary<string, CancellationTokenSource>();

  class Folder { public string path; public int parent; public int level; public long bytes; }

  static void Send(string text) {
    var bytes = new UTF8Encoding(false).GetBytes(text);
    lock (writing) { output.Write(bytes, 0, bytes.Length); output.Flush(); }
  }

  public static void Serve() {
    output = Console.OpenStandardOutput();
    var input = new StreamReader(Console.OpenStandardInput(), new UTF8Encoding(false));
    Send("ready\n");
    string line;
    while ((line = input.ReadLine()) != null) {
      var parts = line.Split('\t');
      if (parts.Length == 2 && parts[1] == "cancel") {
        CancellationTokenSource stop;
        if (running.TryGetValue(parts[0], out stop)) stop.Cancel();
        continue;
      }
      if (parts.Length != 3) continue;
      string id = parts[0], path = parts[2];
      int depth = int.Parse(parts[1]);
      var token = new CancellationTokenSource();
      running[id] = token;
      new Thread(() => Measure(id, path, depth, token.Token)) { IsBackground = true }.Start();
    }
  }

  static string Join(string folder, string name) { return folder.EndsWith("\\") ? folder + name : folder + "\\" + name; }

  static void Measure(string id, string root, int depth, CancellationToken stop) {
    var folders = new List<Folder>();
    folders.Add(new Folder { path = root, parent = -1, level = 0 });
    // A file with several hard links has one id; it is counted once, as du does.
    var seen = new HashSet<Guid>();
    var queue = new BlockingCollection<int>(new ConcurrentQueue<int>());
    queue.Add(0);
    int pending = 1;
    int denied = 0;
    var workers = new Thread[Threads];
    for (int t = 0; t < Threads; t++) {
      workers[t] = new Thread(() => {
        IntPtr buffer = Marshal.AllocHGlobal(BufferSize);
        var id128 = new byte[16];
        try {
          foreach (var index in queue.GetConsumingEnumerable()) {
            Folder folder;
            lock (folders) folder = folders[index];
            long bytes = 0;
            IntPtr handle = stop.IsCancellationRequested ? new IntPtr(-1)
              : CreateFileW("\\\\?\\" + folder.path.TrimEnd('\\') + "\\", ListDirectory, ShareAll, IntPtr.Zero, OpenExisting, BackupSemantics, IntPtr.Zero);
            if (handle == new IntPtr(-1)) {
              if (!stop.IsCancellationRequested && Marshal.GetLastWin32Error() == AccessDenied) Interlocked.Exchange(ref denied, 1);
            } else {
              int infoClass = RestartListing;
              while (!stop.IsCancellationRequested && GetFileInformationByHandleEx(handle, infoClass, buffer, BufferSize)) {
                infoClass = ContinueListing;
                // FILE_ID_EXTD_DIR_INFO: next entry at 0, allocation size at 48,
                // attributes at 56, name length in bytes at 60, 128-bit file id at 72, name at 88.
                int at = 0;
                for (;;) {
                  IntPtr entry = buffer + at;
                  int next = Marshal.ReadInt32(entry, 0);
                  long allocated = Marshal.ReadInt64(entry, 48);
                  uint attributes = (uint)Marshal.ReadInt32(entry, 56);
                  int nameBytes = Marshal.ReadInt32(entry, 60);
                  string name = Marshal.PtrToStringUni(entry + 88, nameBytes / 2);
                  if (name != "." && name != ".." && (attributes & ReparsePoint) == 0) {
                    if ((attributes & Directory) != 0) {
                      int child;
                      lock (folders) {
                        child = folders.Count;
                        folders.Add(new Folder { path = Join(folder.path, name), parent = index, level = folder.level + 1 });
                      }
                      Interlocked.Increment(ref pending);
                      queue.Add(child);
                    } else {
                      Marshal.Copy(entry + 72, id128, 0, 16);
                      bool first;
                      lock (seen) first = seen.Add(new Guid(id128));
                      if (first) bytes += allocated;
                    }
                  }
                  if (next == 0) break;
                  at += next;
                }
              }
              if (Marshal.GetLastWin32Error() == AccessDenied) Interlocked.Exchange(ref denied, 1);
              CloseHandle(handle);
            }
            folder.bytes = bytes;
            if (Interlocked.Decrement(ref pending) == 0) queue.CompleteAdding();
          }
        } finally {
          Marshal.FreeHGlobal(buffer);
        }
      });
      workers[t].Start();
    }
    foreach (var worker in workers) worker.Join();
    CancellationTokenSource ignored;
    running.TryRemove(id, out ignored);
    if (stop.IsCancellationRequested) { Send(id + "\tend\n"); return; }

    // A folder is listed after everything inside it, so adding each one to its
    // parent from the end gives every folder its total, and prints deepest first, like du.
    var text = new StringBuilder();
    var total = new long[folders.Count];
    for (int i = folders.Count - 1; i >= 0; i--) {
      total[i] += folders[i].bytes;
      if (folders[i].parent >= 0) total[folders[i].parent] += total[i];
      if (folders[i].level <= depth) text.Append(id).Append('\t').Append((total[i] + 1023) / 1024).Append('\t').Append(folders[i].path).Append('\n');
    }
    if (denied == 1) text.Append(id).Append("\tdenied\n");
    text.Append(id).Append("\tend\n");
    Send(text.ToString());
  }
}
`;

const SCRIPT = `$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
${SOURCE}
'@
[FixStorageDu]::Serve()
`;

/** Enough of a child process for du() and the culprit search: output, an end, and a way to stop. */
export interface DuProcess {
  readonly pid?: number;
  readonly stdout: NodeJS.ReadableStream;
  readonly stderr: NodeJS.ReadableStream;
  on(event: "close" | "error", listener: () => void): this;
  kill(): void;
}

class Request extends EventEmitter implements DuProcess {
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();
  constructor(
    readonly id: string,
    private readonly cancel: (id: string) => void,
  ) {
    super();
  }
  kill() {
    this.cancel(this.id);
  }
  finish() {
    this.stdout.end();
    this.stderr.end();
    this.emit("close");
  }
}

interface Server {
  child: ChildProcess;
  requests: Map<string, Request>;
}

let server: Promise<Server | null> | null = null;
let nextId = 1;

/** The one PowerShell process, started on first use; null where it cannot run. */
function connect(): Promise<Server | null> {
  return (server ??= new Promise((done) => {
    const encoded = Buffer.from(SCRIPT, "utf16le").toString("base64");
    let child: ChildProcess;
    try {
      child = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-EncodedCommand", encoded], {
        stdio: ["pipe", "pipe", "ignore"],
        windowsHide: true,
      });
    } catch {
      return done(null);
    }
    const requests = new Map<string, Request>();
    const self: Server = { child, requests };
    let ready = false;
    const fail = () => {
      if (!ready) return done(null);
      // It went away mid-run: end what it was doing, and use windu.js from now on.
      for (const request of requests.values()) request.finish();
      requests.clear();
      server = Promise.resolve(null);
    };
    child.on("error", fail);
    child.on("exit", fail);
    createInterface({ input: child.stdout! }).on("line", (line) => {
      if (!ready) {
        if (line === "ready") {
          ready = true;
          idle(self);
          done(self);
        }
        return;
      }
      const tab = line.indexOf("\t");
      const request = requests.get(line.slice(0, tab));
      if (!request) return;
      const rest = line.slice(tab + 1);
      if (rest === "end") {
        requests.delete(request.id);
        request.finish();
        idle(self);
      } else if (rest === "denied") request.stderr.write("Permission denied\n");
      else request.stdout.write(rest + "\n");
    });
  }));
}

/** Holds the process open only while it is measuring, so a finished --plain run can exit. */
function idle(self: Server) {
  const pipes = [self.child.stdin, self.child.stdout] as unknown as Array<{ ref(): void; unref(): void }>;
  if (self.requests.size > 0) {
    self.child.ref();
    for (const pipe of pipes) pipe.ref();
  } else {
    self.child.unref();
    for (const pipe of pipes) pipe.unref();
  }
}

/**
 * Starts measuring a folder, reporting every folder down to `depth` levels
 * (0: just this one). Resolves to null where the server cannot run.
 */
export async function measureFolder(path: string, depth: number): Promise<DuProcess | null> {
  const self = await connect();
  if (!self || path.includes("\n") || path.includes("\t")) return null;
  const id = String(nextId++);
  const request = new Request(id, (which) => {
    if (self.requests.has(which)) self.child.stdin!.write(`${which}\tcancel\n`);
  });
  self.requests.set(id, request);
  idle(self);
  self.child.stdin!.write(`${id}\t${depth}\t${path}\n`);
  return request;
}
