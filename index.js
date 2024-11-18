const path = require("path"); // Importa o módulo path para manipulação de caminhos

function logWithTimestamp(...msg) {
  const timestamp = new Date().toLocaleString("br");
  console.log(`[${timestamp}] ${[...msg].join(" ")}`);
}

const oldRequire = require;
require = function (...x) {
  logWithTimestamp("[Require] Biblioteca carregada " + x);
  return oldRequire(...x);
};

const fs = require("fs");
const express = require("express");
const multer = require("multer");
const config = require("./config.json");
const archiveUtils = require("./utils/decompress");
const os = require("os");

function getCurrentIP() {
  const interfaces = os.networkInterfaces();
  for (const iface in interfaces) {
    for (const ifaceDetails of interfaces[iface]) {
      if (ifaceDetails.family === "IPv4" && !ifaceDetails.internal) {
        return ifaceDetails.address;
      }
    }
  }
  return "IP não encontrado";
}

logWithTimestamp(
  "[Gerenciador de Arquivos] Verificando se o diretório",
  config["Pasta do servidor"],
  "(no config.json) existe."
);

if (!fs.existsSync(config["Pasta do servidor"])) {
  logWithTimestamp(
    "[Gerenciador de Arquivos] Diretório não encontrado. Criando diretório",
    config["Pasta do servidor"],
    "."
  );
  fs.mkdirSync(config["Pasta do servidor"]);
  logWithTimestamp(
    "[Gerenciador de Arquivos] Diretório",
    config["Pasta do servidor"],
    "agora existe."
  );
} else {
  logWithTimestamp(
    "[Gerenciador de Arquivos] Diretório",
    config["Pasta do servidor"],
    "(no config.json) existe, prosseguindo."
  );
}

logWithTimestamp("[Servidor] Criando aplicativo express...");

const app = express();


logWithTimestamp("[Servidor] Iniciando logger customizado...");
app.use((req, res, next) => {
  if (req.method === 'GET') {
    console.log(`[${new Date().toLocaleString("br")}] ${req.method} ${req.originalUrl}`);
  }
  next();
});

// Middleware para logar quando a resposta for enviada
app.use((req, res, next) => {
  const oldSend = res.send;
  res.send = function (body) {
    console.log(`[${new Date().toLocaleString("br")}] ${req.method} ${req.originalUrl} finalizou - Status ${res.statusCode}`);
    oldSend.call(this, body);
  };
  next();
});
logWithTimestamp("[Servidor] Configurando rota estática pública...");
app.use(express.static("public"));

logWithTimestamp("[Servidor] Configurando parser de corpo...");
app.use(express.json());

const ip = getCurrentIP();
logWithTimestamp("[Servidor] Iniciando na porta 3001...");

app.listen(3001, () => {
  logWithTimestamp(`[Servidor] Iniciado na porta 3001, http://${ip}:3001`);
});

// Função para obter o caminho completo usando a config["Pasta do servidor"] como base
function doError() {
  throw new Error("this should not happen... hmm");
}
const maindir = path.join(__dirname, config["Pasta do servidor"]);
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
// Rota para criar arquivo
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

// Rota para criar pasta
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
      totalSize += getFolderSize(filePath); // Recursão para subpastas
    } else {
      totalSize += stats.size; // Soma o tamanho do arquivo
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
        path: filePath.split(path.sep).slice(1).join(path.sep).replace(maindir.slice(1) + "/", ""),
        isCompressed: false, // Pode ser calculado sob demanda
        isDir,
        size: isDir ? (config["Mostrar tamanho das pastas (pode causar lentidão)"] ? formatSize(getFolderSize(filePath)) : "—") : `${formatSize(stats.size)}`, // Calcula tamanho apenas para arquivos
        modifiedDate: formatDate(stats.mtime),
      };
    });

    // Ordena pastas antes dos arquivos
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

// Rota para listar arquivos
app.get("/list-files", (req, res) => {
  const { path: relativePath } = req.query;
  const fullPath = getFullPath(relativePath || "");

  try {
    const files = listFiles(fullPath);

    // Se a path relativa não estiver vazia, adiciona a pasta ".." fictícia
    if (relativePath !== "") {
      const arentDir = fullPath.split("/");
      arentDir.pop();
      const parentDir = arentDir.join("/");
      const phantomDir = {
        name: "..",
        path: (parentDir.split("/").slice(1).join("/")).replace(maindir.slice("1"), ""),
        isCompressed: false,
        isDir: true,
        size: "Nenhum", // Tamanho fictício
        modifiedDate: "Nunca", // Data fictícia
      };
      files.unshift(phantomDir); // Adiciona no início da lista
    }

    res.status(200).json({ success: true, files });
  } catch (e) {
    return res.status(500).json({
      success: false,
      message: "Erro ao listar arquivos: " + e.message,
    });
  }
});

// Função para formatar o tamanho do arquivo
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

// Função para formatar a data de modificação
function formatDate(date) {
  const pad = (n) => n.toString().padStart(2, "0");
  return `${pad(date.getDate())}/${pad(
    date.getMonth() + 1
  )}/${date.getFullYear()} ${pad(date.getHours())}:${pad(
    date.getMinutes()
  )}:${pad(date.getSeconds())}`;
}

// Rota para descompactar arquivo
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
// Rota para comprimir arquivo
app.post("/compress-file", (req, res) => {
  const { path: relativePath } = req.body;
  const fullPath = getFullyPath(relativePath.split("/").splice(1).join("/"));

  const outputFile = `${fullPath}.7z`; // Define o nome de saída como .zip
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

// Rota para renomear/mover arquivo
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
// Função recursiva para copiar diretórios e seus conteúdos
const copyDirectory = (source, destination, callback) => {
  fs.readdir(source, (err, items) => {
    if (err) return callback(err);

    // Verifica se o diretório de destino existe, caso contrário, cria
    fs.mkdir(destination, { recursive: true }, (err) => {
      if (err) return callback(err);

      // Processa cada item no diretório
      let count = items.length;
      if (count === 0) return callback(null); // Se o diretório estiver vazio, chama o callback

      items.forEach((item) => {
        const sourceItem = path.join(source, item);
        const destinationItem = path.join(destination, item);

        fs.stat(sourceItem, (err, stats) => {
          if (err) return callback(err);

          if (stats.isDirectory()) {
            // Se for um diretório, chama recursivamente
            copyDirectory(sourceItem, destinationItem, (err) => {
              if (err) return callback(err);
              count--;
              if (count === 0) callback(null);
            });
          } else {
            // Se for um arquivo, copia o arquivo
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

// Rota para copiar arquivo ou diretório
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
        // Se for diretório, usa a função recursiva para copiar o diretório
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
        // Se for arquivo, usa o fs.copyFile
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

  // Check if the path contains "*" and remove it
  if (relativePath.includes("*")) {
    fullPath = fullPath.replace("*", ""); // Remove the "*" from the path

    // If it's a directory, delete all contents recursively
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
    // If no "*" in the path, treat it as a single file to delete
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

// Rota para enviar arquivo (upload)
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
// Rota para baixar arquivo
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

// Rota para editar conteúdo de um arquivo
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

// Rota para obter conteúdo de um arquivo e verificar se é binário
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

// Função para verificar se o arquivo é binário
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
// Rota para baixar uma pastaconst tempFiles = new Map();

app.get("/download-folder", async (req, res) => {
  const { path: relativePath } = req.query;
  const folderPath = getFullPath(relativePath || "");
  const tempArchivePath = path.join(
    __dirname,
    "temp",
    `${Date.now()}_folder.7z`
  );

  // Verifica se a pasta existe
  if (!fs.existsSync(folderPath)) {
    return res
      .status(404)
      .json({ success: false, message: "Pasta não encontrada." });
  }

  try {
    // Comprime a pasta usando o archiveUtils
    await archiveUtils.compressFile(folderPath, tempArchivePath);

    // Adiciona o arquivo temporário à lista para exclusão futura
    tempFiles.set(tempArchivePath, Date.now());
    const name =
      (relativePath
        ? relativePath.includes("/")
          ? relativePath.split("/").slice(1).join("/").replaceAll("/", "-")
          : relativePath
        : "Root ") + " Download.7z";
    // Envia o arquivo para o cliente
    logWithTimestamp("[Gerenciador de Arquivos] Arquivo gerado: " + name);

    res.download(tempArchivePath, name, (err) => {
      // Apaga o arquivo temporário após o envio
      fs.unlink(tempArchivePath, (unlinkErr) => {
        if (unlinkErr) {
          logWithTimestamp(
            "[Gerenciador de Arquivos] Erro ao apagar arquivo temporário:",
            unlinkErr.message
          );
        }
      });

      if (err) {
        logWithTimestamp(
          "[Gerenciador de Arquivos] Erro ao enviar arquivo:",
          err.message
        );
        return res.status(500).json({
          success: false,
          message: "Erro ao baixar pasta.",
        });
      }
    });
  } catch (err) {
    logWithTimestamp(
      "[Gerenciador de Arquivos] Erro ao comprimir pasta:",
      err.message
    );
    res.status(500).json({
      success: false,
      message: "Erro ao comprimir pasta.",
    });
  }
});

// Limpeza periódica de arquivos temporários
setInterval(() => {
  const now = Date.now();
  logWithTimestamp("[Lixeiro] Procurando arquivos antigos...");

  // Altere o diretório para onde seus arquivos estão armazenados
  const dirPath = __dirname + "/temp";

  fs.readdir(dirPath, (err, files) => {
    if (err) {
      logWithTimestamp("[Lixeiro] Erro ao ler o diretório:", err.message);
      return;
    }

    files.forEach((file) => {
      const filePath = path.join(dirPath, file);
      const timestamp = parseInt(file.split("_")[0]);

      if (!isNaN(timestamp)) {
        const remainingTime = now - timestamp;
        const maxAge = config.Lixeiro["Idade máxima do arquivo (em minutos)"] * 60 * 1000;

        if (remainingTime < maxAge) {
          const timeLeft = maxAge - remainingTime;
          const minutesLeft = Math.floor(timeLeft / 60000);
          const secondsLeft = Math.floor((timeLeft % 60000) / 1000);

          logWithTimestamp(
            `[Lixeiro] Tempo restante para apagar o arquivo '${file}': ${minutesLeft}m ${secondsLeft}s`
          );
        } else {
          fs.unlink(filePath, (err) => {
            if (err) {
              logWithTimestamp(
                "[Lixeiro] Erro ao apagar arquivo temporário:",
                err.message
              );
            } else {
              logWithTimestamp(
                "[Lixeiro] Arquivo temporário apagado:",
                filePath
              );
            }
          });
        }
      }
    });
  });
}, config.Lixeiro["Intervalo de Verificação (limpeza de arquivos antigos)"] * 1000);
