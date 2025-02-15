const path = require("path");
const fs = require("fs");
const express = require("express");
const multer = require("multer");
const config = require("./config.json");
const archiveUtils = require("./utils/decompress");
const os = require("os")
function resolveUnixPath(unixPath) {
  if (unixPath.startsWith('~')) {
    unixPath = unixPath.replace("~", os.homedir())
  }
  return path.resolve(unixPath);
}
const maindir = resolveUnixPath(config["Pasta do servidor"]);

if (!fs.existsSync(maindir)) {
  fs.mkdirSync(maindir);
}

if (!fs.existsSync("temp")) {
  fs.mkdirSync("temp");
}
const app = express();
app.use(express.static("public"));

app.use(express.json());
app.listen(3001);

function getFullPath(relativePath) {
  relativePath = relativePath
    .replaceAll(maindir, "")
    .replaceAll("/" + maindir, "")
    .replaceAll(maindir.slice(1), "");
  let fullPath = path.resolve(path.join(maindir, relativePath));

  if (!fullPath.startsWith(maindir))
    return path.join(
      maindir,
      relativePath.includes("/") ? relativePath.split("/").pop() : ""
    );
  return fullPath;
}
app.post("/create-file", (req, res) => {
  const { path: relativePath, content } = req.body;
  const fullPath = getFullPath(relativePath);

  fs.writeFile(fullPath, content, (err) => {
    if (err) {
      return res
        .status(500)
        .json({ success: false, message: "Erro ao criar arquivo." });
    }
    res
      .status(200)
      .json({ success: true, message: "Arquivo criado com sucesso." });
  });
});
app.post("/create-dir", (req, res) => {
  const { path: relativePath } = req.body;
  const fullPath = getFullPath(relativePath);

  fs.mkdir(fullPath, { recursive: true }, (err) => {
    if (err) {
      return res.status(500).json({
        success: false,
        message: "Erro ao criar pasta: " + err.message,
      });
    }
    res
      .status(200)
      .json({ success: true, message: "Pasta criada com sucesso." });
  });
});

function getFolderSize(folderPath) {
  let totalSize = 0;

  const files = fs.readdirSync(folderPath);
  files.forEach((file) => {
    const filePath = path.join(folderPath, file);
    const stats = fs.statSync(filePath);

    if (stats.isDirectory()) {
      totalSize += getFolderSize(filePath);
    } else {
      totalSize += stats.size;
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
        isCompressed: false, // Pode ser calculado sob demanda
        isDir,
        size: isDir
          ? config["Mostrar tamanho das pastas (pode causar lentidão)"]
            ? formatSize(getFolderSize(filePath))
            : "—"
          : `${formatSize(stats.size)}`,
        modifiedDate: formatDate(stats.mtime),
      };
    });
    filesDetails.sort((a, b) => {
      if (a.isDir && !b.isDir) return -1;
      if (!a.isDir && b.isDir) return 1;
      return a.name.localeCompare(b.name);
    });

    return filesDetails;
  } catch (error) {
    throw new Error(`Erro ao listar diretório: ${error.message}`);
  }
}
app.get("/list-files", (req, res) => {
  const { path: relativePath } = req.query;
  const fullPath = getFullPath(relativePath || "");

  try {
    const files = listFiles(fullPath);
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
        size: "Nenhum",
        modifiedDate: "Nunca",
      };
      files.unshift(phantomDir)
    }

    res.status(200).json({ success: true, files });
  } catch (e) {
    return res.status(500).json({
      success: false,
      message: "Erro ao listar arquivos: " + e.message,
    });
  }
});
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
function formatDate(date) {
  const pad = (n) => n.toString().padStart(2, "0");
  return `${pad(date.getDate())}/${pad(
    date.getMonth() + 1
  )}/${date.getFullYear()} ${pad(date.getHours())}:${pad(
    date.getMinutes()
  )}:${pad(date.getSeconds())}`;
}
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
        .json({ success: true, message: "Arquivo descompactado com sucesso." });
    })
    .catch((e) => {
      return res
        .status(500)
        .json({ success: false, message: "Erro ao descompactar arquivo." });
    });
});
app.post("/compress-file", (req, res) => {
  const { path: relativePath } = req.body;
  const fullPath = getFullPath(relativePath.split("/").splice(1).join("/"));

  const outputFile = `${fullPath}.7z`;
  try {
    archiveUtils.compressFile(fullPath, outputFile).then(() => {
      res
        .status(200)
        .json({ success: true, message: "Arquivo compactado com sucesso." });
    });
  } catch (e) {
    return res
      .status(500)
      .json({ success: false, message: "Erro ao compactar arquivo." });
  }
});
app.post("/rename-move", (req, res) => {
  const { oldPath: relativeOldPath, newPath: relativeNewPath } = req.body;
  try {
    const fullOldPath = getFullPath(relativeOldPath);
    const fullNewPath = getFullPath(relativeNewPath);
    fs.rename(fullOldPath, fullNewPath, (err) => {
      if (err) {
        return res
          .status(500)
          .json({ success: false, message: "Erro ao renomear/mover arquivo." });
      }
      res.status(200).json({
        success: true,
        message: "Arquivo renomeado/movido com sucesso.",
      });
    });
  } catch (e) {
    return res
      .status(500)
      .json({ success: false, message: "Erro ao renomear/mover arquivo." });
  }
});
const copyDirectory = (source, destination, callback) => {
  fs.readdir(source, (err, items) => {
    if (err) return callback(err);
    fs.mkdir(destination, { recursive: true }, (err) => {
      if (err) return callback(err);
      let count = items.length;
      if (count === 0) return callback(null);
      items.forEach((item) => {
        const sourceItem = path.join(source, item);
        const destinationItem = path.join(destination, item);
        fs.stat(sourceItem, (err, stats) => {
          if (err) return callback(err);
          if (stats.isDirectory()) {
            copyDirectory(sourceItem, destinationItem, (err) => {
              if (err) return callback(err);
              count--;
              if (count === 0) callback(null);
            });
          } else {
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
          message: "Erro ao acessar o arquivo ou diretório.",
        });
      }

      if (stats.isDirectory()) {
        copyDirectory(fullOldPath, fullNewPath, (err) => {
          if (err) {
            console.error(err);
            return res
              .status(500)
              .json({ success: false, message: "Erro ao copiar diretório." });
          }
          res.status(200).json({
            success: true,
            message: "Diretório copiado com sucesso.",
          });
        });
      } else {
        fs.copyFile(fullOldPath, fullNewPath, (err) => {
          if (err) {
            console.error(err);
            return res
              .status(500)
              .json({ success: false, message: "Erro ao copiar arquivo." });
          }
          res.status(200).json({
            success: true,
            message: "Arquivo copiado com sucesso.",
          });
        });
      }
    });
  } catch (e) {
    console.error(e);
    return res.status(500).json({
      success: false,
      message: "Erro ao copiar arquivo ou diretório.",
    });
  }
});

// Rota para apagar arquivo/pasta
app.delete("/delete", (req, res) => {
  const { path: relativePath } = req.body;
  let fullPath = getFullPath(relativePath);
  if (relativePath.includes("*")) {
    fullPath = fullPath.replace("*", "");
    fs.readdir(fullPath, (err, files) => {
      if (err) {
        console.error("Error reading directory:", err);
        return res
          .status(500)
          .json({ success: false, message: "Erro ao acessar diretório." });
      }
      let deletePromises = files.map((file) => {
        const filePath = path.join(fullPath, file);
        return new Promise((resolve, reject) => {
          fs.rm(filePath, { recursive: true, force: true }, (err) => {
            if (err) {
              reject(`Erro ao apagar: ${filePath}`);
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
            message: "Conteúdo da pasta apagado com sucesso.",
          });
        })
        .catch((err) => {
          res.status(500).json({ success: false, message: err });
        });
    });
  } else {
    fs.rm(fullPath, { recursive: true, force: true }, (err) => {
      if (err) {
        console.error("Error deleting file:", err);
        return res
          .status(500)
          .json({ success: false, message: "Erro ao apagar arquivo." });
      }
      res
        .status(200)
        .json({ success: true, message: "Arquivo apagado com sucesso." });
    });
  }
});
const upload = multer({ dest: "uploads/" });
app.post("/upload-file", upload.single("file"), async (req, res) => {
  if (!req.file) {
    return res
      .status(400)
      .json({ success: false, message: "Nenhum arquivo enviado." });
  }

  fs.renameSync(
    req.file.path,
    path.join(getFullPath(req.query.path), req.file.originalname)
  );

  res.status(200).json({
    success: true,
    message: `Arquivo ${req.file.originalname} enviado com sucesso.`,
  });
});
app.get("/download-file", (req, res) => {
  const { path: relativePath } = req.query;
  const fullPath = getFullPath(relativePath);

  if (!fs.existsSync(fullPath)) {
    return res
      .status(404)
      .json({ success: false, message: "Arquivo não encontrado." });
  }

  res.download(fullPath, (err) => {
    if (err) {
      return res
        .status(500)
        .json({ success: false, message: "Erro ao baixar arquivo." });
    }
  });
});
app.post("/edit-file", (req, res) => {
  const { path: relativePath, content } = req.body;
  const fullPath = getFullPath(relativePath);

  if (!fs.existsSync(fullPath)) {
    return res
      .status(404)
      .json({ success: false, message: "Arquivo não encontrado." });
  }

  fs.writeFile(fullPath, content, (err) => {
    if (err) {
      return res
        .status(500)
        .json({ success: false, message: "Erro ao editar arquivo." });
    }
    res
      .status(200)
      .json({ success: true, message: "Arquivo editado com sucesso." });
  });
});
app.post("/get-file-content", (req, res) => {
  const { path: relativePath } = req.body;
  const fullPath = getFullPath(relativePath);

  if (!fs.existsSync(fullPath)) {
    return res
      .status(404)
      .json({ success: false, message: "Arquivo não encontrado." });
  }

  const isBinary = checkIfBinary(fullPath);
  if (isBinary) {
    return res.status(400).json({
      success: false,
      message: "Arquivo binário detectado, não pode ser lido como texto.",
    });
  }

  fs.readFile(fullPath, "utf8", (err, data) => {
    if (err) {
      return res
        .status(500)
        .json({ success: false, message: "Erro ao ler arquivo." });
    }
    res.status(200).json({ success: true, content: data });
  });
});
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
app.get("/download-folder", async (req, res) => {
  const { path: relativePath } = req.query;
  const folderPath = getFullPath(relativePath || "");
  const tempArchivePath = path.join(
    __dirname,
    "temp",
    `${Date.now()}_folder.7z`
  );
  if (!fs.existsSync(folderPath)) {
    return res
      .status(404)
      .json({ success: false, message: "Pasta não encontrada." });
  }
  try {
    await archiveUtils.compressFile(folderPath, tempArchivePath);
    const name =
      (relativePath
        ? relativePath.includes("/")
          ? relativePath.split("/").slice(1).join("/").replaceAll("/", "-")
          : relativePath
        : "Root ") + " Download.7z";

    res.download(tempArchivePath, name, (err) => {
      fs.unlink(tempArchivePath, (unlinkErr) => {
        if (unlinkErr) {
        }
      });

      if (err) {
        return res.status(500).json({
          success: false,
          message: "Erro ao baixar pasta.",
        });
      }
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      message: "Erro ao comprimir pasta.",
    });
  }
});
setInterval(() => {
  const now = Date.now();
  const dirPath = __dirname + "/temp";
  fs.readdir(dirPath, (err, files) => {
    if (err) {
      return;
    }
    files.forEach((file) => {
      const filePath = path.join(dirPath, file);
      const timestamp = parseInt(file.split("_")[0]);
      if (!isNaN(timestamp)) {
        const remainingTime = now - timestamp;
        const maxAge =
          config.Lixeiro["Idade máxima do arquivo (em minutos)"] * 60 * 1000
        if (remainingTime > maxAge) {
          fs.unlinkSync(filePath);
        }
      }
    });
  });
}, config.Lixeiro["Intervalo de Verificação (limpeza de arquivos antigos)"] * 1000);
