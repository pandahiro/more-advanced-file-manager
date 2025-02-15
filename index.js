const path = require("path"); // Import the path module for path manipulation

function logWithTimestamp(...msg) {
  const timestamp = new Date().toLocaleString("br");
  console.log(`[${timestamp}] ${[...msg].join(" ")}`);
}

const oldRequire = require;
require = function (...x) {
  logWithTimestamp("[Require] Library loaded " + x);
  return oldRequire(...x);
};

const fs = require("fs");
const express = require("express");
const multer = require("multer");
const config = require("./config.json");
const archiveUtils = require("./utils/decompress");
const os = require("os");

function getCurrentIP() {
  try {
    const interfaces = os.networkInterfaces();
    for (const iface in interfaces) {
      for (const ifaceDetails of interfaces[iface]) {
        if (ifaceDetails.family === "IPv4" && !ifaceDetails.internal) {
          return ifaceDetails.address;
        }
      }
    }
  } catch (e) {
    return "?";
  }
}

logWithTimestamp(
  "[File Manager] Checking if the directory",
  config["Server Folder"],
  "(in config.json) exists."
);

if (!fs.existsSync(config["Server Folder"])) {
  logWithTimestamp(
    "[File Manager] Directory not found. Creating directory",
    config["Server Folder"],
    "."
  );
  fs.mkdirSync(config["Server Folder"]);
  logWithTimestamp(
    "[File Manager] Directory",
    config["Server Folder"],
    "now exists."
  );
} else {
  logWithTimestamp(
    "[File Manager] Directory",
    config["Server Folder"],
    "(in config.json) exists, proceeding."
  );
}

logWithTimestamp("[Server] Creating express app...");

const app = express();

logWithTimestamp("[Server] Starting custom logger...");
app.use((req, res, next) => {
  if (req.method === "GET") {
    console.log(
      `[${new Date().toLocaleString("br")}] ${req.method} ${req.originalUrl}`
    );
  }
  next();
});

// Middleware to log when the response is sent
app.use((req, res, next) => {
  const oldSend = res.send;
  res.send = function (body) {
    console.log(
      `[${new Date().toLocaleString("br")}] ${req.method} ${
        req.originalUrl
      } finished - Status ${res.statusCode}`
    );
    oldSend.call(this, body);
  };
  next();
});
logWithTimestamp("[Server] Setting up public static route...");
app.use(express.static("public"));

logWithTimestamp("[Server] Setting up body parser...");
app.use(express.json());

const ip = getCurrentIP();
logWithTimestamp("[Server] Starting on port 3001...");

app.listen(3001, () => {
  logWithTimestamp(`[Server] Started on port 3001, http://${ip}:3001`);
});

// Function to get the full path using config["Server Folder"] as the base
function doError() {
  throw new Error("this should not happen... hmm");
}
const maindir = path.join(__dirname, config["Server Folder"]);
function getFullPath2(relativePath) {
  relativePath = relativePath
    .replaceAll(maindir, "")
    .replaceAll("/" + maindir, "")
    .replaceAll(maindir.slice(1), "");
  let fullPath = path.resolve(path.join(maindir, relativePath));

  if (!fullPath.startsWith(maindir))
    return path.join(
      maindir,
      relativePath.includes("/") ? relativePath.split("/").pop() : doError()
    );
  return fullPath;
}

function getFullyPath(relativePath) {
  getFullPath(relativePath);
}
function getFullPath(relativePath) {
  return getFullPath2(relativePath);
}
// Route to create a file
app.post("/create-file", (req, res) => {
  const { path: relativePath, content } = req.body;
  const fullPath = getFullPath(relativePath);

  fs.writeFile(fullPath, content, (err) => {
    if (err) {
      return res
        .status(500)
        .json({ success: false, message: "Error creating file." });
    }
    res
      .status(200)
      .json({ success: true, message: "File created successfully." });
  });
});

// Route to create a folder
app.post("/create-dir", (req, res) => {
  const { path: relativePath } = req.body;
  const fullPath = getFullPath(relativePath);

  fs.mkdir(fullPath, { recursive: true }, (err) => {
    if (err) {
      return res.status(500).json({
        success: false,
        message: "Error creating folder: " + err.message,
      });
    }
    res
      .status(200)
      .json({ success: true, message: "Folder created successfully." });
  });
});

function getFolderSize(folderPath) {
  let totalSize = 0;

  const files = fs.readdirSync(folderPath);
  files.forEach((file) => {
    const filePath = path.join(folderPath, file);
    const stats = fs.statSync(filePath);

    if (stats.isDirectory()) {
      totalSize += getFolderSize(filePath); // Recursion for subfolders
    } else {
      totalSize += stats.size; // Sum the file size
    }
  });

  return totalSize;
}

function listFiles(mpath) {
  try {
    const files = fs.readdirSync(mpath, { withFileTypes: true });

    const filesDetails = files.map((file) => {
      const filePath = path.join(mpath, file.name);
      const stats = fs.statSync(filePath);
      const isDir = stats.isDirectory();

      return {
        name: file.name,
        path: filePath
          .split(path.sep)
          .slice(1)
          .join(path.sep)
          .replace(maindir.slice(1) + "/", ""),
        isCompressed: false, // Can be calculated on demand
        isDir,
        size: isDir
          ? config["Show folder size (may cause slowness)"]
            ? formatSize(getFolderSize(filePath))
            : "—"
          : `${formatSize(stats.size)}`, // Calculate size only for files
        modifiedDate: formatDate(stats.mtime),
      };
    });

    // Sort folders before files
    filesDetails.sort((a, b) => {
      if (a.isDir && !b.isDir) return -1;
      if (!a.isDir && b.isDir) return 1;
      return a.name.localeCompare(b.name);
    });

    return filesDetails;
  } catch (error) {
    throw new Error(`Error listing directory: ${error.message}`);
  }
}

// Route to list files
app.get("/list-files", (req, res) => {
  const { path: relativePath } = req.query;
  const fullPath = getFullPath(relativePath || "");

  try {
    const files = listFiles(fullPath);

    // If the relative path is not empty, add the ".." phantom folder
    if (relativePath !== "") {
      const arentDir = fullPath.split("/");
      arentDir.pop();
      const parentDir = arentDir.join("/");
      const phantomDir = {
        name: "..",
        path: parentDir
          .split("/")
          .slice(1)
          .join("/")
          .replace(maindir.slice("1"), ""),
        isCompressed: false,
        isDir: true,
        size: "None", // Phantom size
        modifiedDate: "Never", // Phantom date
      };
      files.unshift(phantomDir); // Add to the beginning of the list
    }

    res.status(200).json({ success: true, files });
  } catch (e) {
    return res.status(500).json({
      success: false,
      message: "Error listing files: " + e.message,
    });
  }
});

// Function to format file size
function formatSize(bytes) {
  const units = ["Bytes", "KB", "MB", "GB"];
  const units2 = [0, 1, 2, 2];
  let i = 0;
  while (bytes >= 1024 && i < units.length - 1) {
    bytes /= 1024;
    i++;
  }
  return `${bytes.toFixed(units2[i])} ${units[i]}`;
}

// Function to format modification date
function formatDate(date) {
  const pad = (n) => n.toString().padStart(2, "0");
  return `${pad(date.getDate())}/${pad(
    date.getMonth() + 1
  )}/${date.getFullYear()} ${pad(date.getHours())}:${pad(
    date.getMinutes()
  )}:${pad(date.getSeconds())}`;
}

// Route to extract a file
app.post("/extract-file", (req, res) => {
  const { path: relativePath } = req.body;
  const fullPath = getFullPath(relativePath);
  const arentDir = fullPath.split("/");
  arentDir.pop();
  const parentDir = arentDir.join("/");

  archiveUtils
    .extractFile(fullPath, parentDir)
    .then(() => {
      res
        .status(200)
        .json({ success: true, message: "File extracted successfully." });
    })
    .catch((e) => {
      return res
        .status(500)
        .json({ success: false, message: "Error extracting file." });
    });
});
// Route to compress a file
app.post("/compress-file", (req, res) => {
  const { path: relativePath } = req.body;
  const fullPath = getFullyPath(relativePath.split("/").splice(1).join("/"));

  const outputFile = `${fullPath}.7z`; // Define the output name as .zip
  try {
    archiveUtils.compressFile(fullPath, outputFile).then(() => {
      res
        .status(200)
        .json({ success: true, message: "File compressed successfully." });
    });
  } catch (e) {
    return res
      .status(500)
      .json({ success: false, message: "Error compressing file." });
  }
});

// Route to rename/move a file
app.post("/rename-move", (req, res) => {
  const { oldPath: relativeOldPath, newPath: relativeNewPath } = req.body;
  try {
    const fullOldPath = getFullPath(relativeOldPath);
    const fullNewPath = getFullPath(relativeNewPath);
    fs.rename(fullOldPath, fullNewPath, (err) => {
      if (err) {
        return res
          .status(500)
          .json({ success: false, message: "Error renaming/moving file." });
      }
      res.status(200).json({
        success: true,
        message: "File renamed/moved successfully.",
      });
    });
  } catch (e) {
    return res
      .status(500)
      .json({ success: false, message: "Error renaming/moving file." });
  }
});
// Recursive function to copy directories and their contents
const copyDirectory = (source, destination, callback) => {
  fs.readdir(source, (err, items) => {
    if (err) return callback(err);

    // Check if the destination directory exists, if not, create it
    fs.mkdir(destination, { recursive: true }, (err) => {
      if (err) return callback(err);

      // Process each item in the directory
      let count = items.length;
      if (count === 0) return callback(null); // If the directory is empty, call the callback

      items.forEach((item) => {
        const sourceItem = path.join(source, item);
        const destinationItem = path.join(destination, item);

        fs.stat(sourceItem, (err, stats) => {
          if (err) return callback(err);

          if (stats.isDirectory()) {
            // If it's a directory, call recursively
            copyDirectory(sourceItem, destinationItem, (err) => {
              if (err) return callback(err);
              count--;
              if (count === 0) callback(null);
            });
          } else {
            // If it's a file, copy the file
            fs.copyFile(sourceItem, destinationItem, (err) => {
              if (err) return callback(err);
              count--;
              if (count === 0) callback(null);
            });
          }
        });
      });
    });
  });
};

// Route to copy a file or directory
app.post("/copy-file", (req, res) => {
  const { oldPath: relativeOldPath, newPath: relativeNewPath } = req.body;
  try {
    const fullOldPath = getFullPath(relativeOldPath);
    const fullNewPath = getFullPath(relativeNewPath);

    fs.stat(fullOldPath, (err, stats) => {
      if (err) {
        console.error(err);
        return res.status(500).json({
          success: false,
          message: "Error accessing the file or directory.",
        });
      }

      if (stats.isDirectory()) {
        // If it's a directory, use the recursive function to copy the directory
        copyDirectory(fullOldPath, fullNewPath, (err) => {
          if (err) {
            console.error(err);
            return res
              .status(500)
              .json({ success: false, message: "Error copying directory." });
          }
          res.status(200).json({
            success: true,
            message: "Directory copied successfully.",
          });
        });
      } else {
        // If it's a file, use fs.copyFile
        fs.copyFile(fullOldPath, fullNewPath, (err) => {
          if (err) {
            console.error(err);
            return res
              .status(500)
              .json({ success: false, message: "Error copying file." });
          }
          res.status(200).json({
            success: true,
            message: "File copied successfully.",
          });
        });
      }
    });
  } catch (e) {
    console.error(e);
    return res.status(500).json({
      success: false,
      message: "Error copying file or directory.",
    });
  }
});

// Route to delete a file/folder
app.delete("/delete", (req, res) => {
  const { path: relativePath } = req.body;
  let fullPath = getFullPath(relativePath);

  // Check if the path contains "*" and remove it
  if (relativePath.includes("*")) {
    fullPath = fullPath.replace("*", ""); // Remove the "*" from the path

    // If it's a directory, delete all contents recursively
    fs.readdir(fullPath, (err, files) => {
      if (err) {
        console.error("Error reading directory:", err);
        return res
          .status(500)
          .json({ success: false, message: "Error accessing directory." });
      }

      let deletePromises = files.map((file) => {
        const filePath = path.join(fullPath, file);
        return new Promise((resolve, reject) => {
          fs.rm(filePath, { recursive: true, force: true }, (err) => {
            if (err) {
              reject(`Error deleting: ${filePath}`);
            } else {
              resolve();
            }
          });
        });
      });

      Promise.all(deletePromises)
        .then(() => {
          res.status(200).json({
            success: true,
            message: "Folder contents deleted successfully.",
          });
        })
        .catch((err) => {
          res.status(500).json({ success: false, message: err });
        });
    });
  } else {
    // If no "*" in the path, treat it as a single file to delete
    fs.rm(fullPath, { recursive: true, force: true }, (err) => {
      if (err) {
        console.error("Error deleting file:", err);
        return res
          .status(500)
          .json({ success: false, message: "Error deleting file." });
      }
      res
        .status(200)
        .json({ success: true, message: "File deleted successfully." });
    });
  }
});

// Route to upload a file
const upload = multer({ dest: "uploads/" });
app.post("/upload-file", upload.single("file"), async (req, res) => {
  if (!req.file) {
    return res
      .status(400)
      .json({ success: false, message: "No file uploaded." });
  }

  fs.renameSync(
    req.file.path,
    path.join(getFullPath(req.query.path), req.file.originalname)
  );

  res.status(200).json({
    success: true,
    message: `File ${req.file.originalname} uploaded successfully.`,
  });
});
// Route to download a file
app.get("/download-file", (req, res) => {
  const { path: relativePath } = req.query;
  const fullPath = getFullPath(relativePath);

  if (!fs.existsSync(fullPath)) {
    return res
      .status(404)
      .json({ success: false, message: "File not found." });
  }

  res.download(fullPath, (err) => {
    if (err) {
      return res
        .status(500)
        .json({ success: false, message: "Error downloading file." });
    }
  });
});

// Route to edit file content
app.post("/edit-file", (req, res) => {
  const { path: relativePath, content } = req.body;
  const fullPath = getFullPath(relativePath);

  if (!fs.existsSync(fullPath)) {
    return res
      .status(404)
      .json({ success: false, message: "File not found." });
  }

  fs.writeFile(fullPath, content, (err) => {
    if (err) {
      return res
        .status(500)
        .json({ success: false, message: "Error editing file." });
    }
    res
      .status(200)
      .json({ success: true, message: "File edited successfully." });
  });
});

// Route to get file content and check if it's binary
app.post("/get-file-content", (req, res) => {
  const { path: relativePath } = req.body;
  const fullPath = getFullPath(relativePath);

  if (!fs.existsSync(fullPath)) {
    return res
      .status(404)
      .json({ success: false, message: "File not found." });
  }

  const isBinary = checkIfBinary(fullPath);
  if (isBinary) {
    return res.status(400).json({
      success: false,
      message: "Binary file detected, cannot be read as text.",
    });
  }

  fs.readFile(fullPath, "utf8", (err, data) => {
    if (err) {
      return res
        .status(500)
        .json({ success: false, message: "Error reading file." });
    }
    res.status(200).json({ success: true, content: data });
  });
});

// Function to check if the file is binary
function checkIfBinary(filePath) {
  const buffer = fs.readFileSync(filePath);
  let isBinary = false;

  for (let i = 0; i < Math.min(buffer.length, 512); i++) {
    if (buffer[i] === 0) {
      isBinary = true;
      break;
    }
  }

  return isBinary;
}
const tempFiles = new Map();
// Route to download a folder

app.get("/download-folder", async (req, res) => {
  const { path: relativePath } = req.query;
  const folderPath = getFullPath(relativePath || "");
  const tempArchivePath = path.join(
    __dirname,
    "temp",
    `${Date.now()}_folder.7z`
  );

  // Check if the folder exists
  if (!fs.existsSync(folderPath)) {
    return res
      .status(404)
      .json({ success: false, message: "Folder not found." });
  }

  try {
    // Compress the folder using archiveUtils
    await archiveUtils.compressFile(folderPath, tempArchivePath);

    // Add the temporary file to the list for future deletion
    tempFiles.set(tempArchivePath, Date.now());
    const name =
      (relativePath
        ? relativePath.includes("/")
          ? relativePath.split("/").slice(1).join("/").replaceAll("/", "-")
          : relativePath
        : "Root ") + " Download.7z";
    // Send the file to the client
    logWithTimestamp("[File Manager] File generated: " + name);

    res.download(tempArchivePath, name, (err) => {
      // Delete the temporary file after sending
      fs.unlink(tempArchivePath, (unlinkErr) => {
        if (unlinkErr) {
          logWithTimestamp(
            "[File Manager] Error deleting temporary file:",
            unlinkErr.message
          );
        }
      });

      if (err) {
        logWithTimestamp(
          "[File Manager] Error sending file:",
          err.message
        );
        return res.status(500).json({
          success: false,
          message: "Error downloading folder.",
        });
      }
    });
  } catch (err) {
    logWithTimestamp(
      "[File Manager] Error compressing folder:",
      err.message
    );
    res.status(500).json({
      success: false,
      message: "Error compressing folder.",
    });
  }
});

// Periodic cleanup of temporary files
setInterval(() => {
  const now = Date.now();
  logWithTimestamp("[Trash] Looking for old files...");

  // Change the directory to where your files are stored
  const dirPath = __dirname + "/temp";

  fs.readdir(dirPath, (err, files) => {
    if (err) {
      logWithTimestamp("[Trash] Error reading directory:", err.message);
      return;
    }

    files.forEach((file) => {
      const filePath = path.join(dirPath, file);
      const timestamp = parseInt(file.split("_")[0]);

      if (!isNaN(timestamp)) {
        const remainingTime = now - timestamp;
        const maxAge =
          config.Trash["Maximum file age (in minutes)"] * 60 * 1000;

        if (remainingTime < maxAge) {
          const timeLeft = maxAge - remainingTime;
          const minutesLeft = Math.floor(timeLeft / 60000);
          const secondsLeft = Math.floor((timeLeft % 60000) / 1000);

          logWithTimestamp(
            `[Trash] Time remaining to delete file '${file}': ${minutesLeft}m ${secondsLeft}s`
          );
        } else {
          fs.unlink(filePath, (err) => {
            if (err) {
              logWithTimestamp(
                "[Trash] Error deleting temporary file:",
                err.message
              );
            } else {
              logWithTimestamp(
                "[Trash] Temporary file deleted:",
                filePath
              );
            }
          });
        }
      }
    });
  });
}, config.Trash["Check Interval (cleanup of old files)"] * 1000);
