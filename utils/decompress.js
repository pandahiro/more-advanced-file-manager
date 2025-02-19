const path = require("path");
const AdmZip = require("adm-zip");
const tar = require("tar");
const Unrar = require("node-unrar-js");
const Seven = require("node-7z");
const fs = require("fs");

const magicBytes = {
  Zip: [0x50, 0x4b, 0x03, 0x04],
  Gz: [0x1f, 0x8b],
  Tar: [0x75, 0x73, 0x74, 0x61, 0x72],
  "Burrows-Wheeler 2": [0x42, 0x5a, 0x68],
  "7-zip": [0x37, 0x7a, 0x58, 0x5a],
  Rar: [0x52, 0x61, 0x72, 0x21],
};

const detectFormat = (filePath) => {
  const buffer = fs.readFileSync(filePath, { start: 0, end: 4 });

  for (let format in magicBytes) {
    if (magicBytes[format].every((byte, i) => byte === buffer[i])) {
      return format;
    }
  }
  return null;
};

const extractFile = async (inputPath, outputPath) => {
  const format = detectFormat(inputPath);

  if (!format) {
    console.error("File format is invalid.");
    return;
  }

  try {
    if (format === "Zip") {
      const zip = new AdmZip(inputPath);
      zip.extractAllTo(outputPath, true);
      console.log("Zip Extracted!");
    } else if (format === "Tar") {
      await tar.x({ file: inputPath, cwd: outputPath });
      console.log("Tar extracted!");
    } else if (format === "7-zip") {
      const extractor = Seven.extractFull(inputPath, outputPath, {
        $bin: "7z",
      });
      extractor.on("end", () =>
        console.log("7Z extracted!")
      );
      extractor.on("error", (err) => console.error("Erro ao extrair 7Z:", err));
    } else if (format === "Rar") {
      const unrar = new Unrar();
      const data = fs.readFileSync(inputPath);
      const archive = unrar.createExtractorFromData(data);
      const extracted = archive.extractAll();

      if (extracted[0].state === "SUCCESS") {
        extracted[1].files.forEach((file) => {
          fs.writeFileSync(
            `${outputPath}/${file.fileHeader.name}`,
            file.fileData
          );
        });
        console.log("Rar EXTRACTED!");
      } else {
        console.error("Rar FAIL:", extracted[0].state);
      }
    } else {
      console.error("File format not supported:", format);
    }
  } catch (err) {
    console.error("Error:", err);
  }
};
const { promisify } = require("util");
const exec = promisify(require("child_process").exec);
const os = require("os");

// Função para verificar permissões de execução no Unix
const ensureExecutablePermission = (filePath) => {
  return new Promise((resolve, reject) => {
    fs.access(filePath, fs.constants.X_OK, (err) => {
      if (err) {
        // Tenta conceder permissão de execução se não houver
        exec(`chmod +x ${filePath}`)
          .then(() => resolve())
          .catch(resolve);
      } else {
        resolve();
      }
    });
  });
};

// Função para compactar diretórios e arquivos com 7z
const compressFile = (inputPath, outputPath) => {
  return new Promise((resolve, reject) => {
    const stats = fs.statSync(inputPath);

    if (stats.isDirectory() || stats.isFile()) {
      // Determina o caminho do binário 7za conforme o SO
      const platform = os.platform();
      const arch = os.arch();
      let sevenZipPath = path.join(
        __dirname,
        "..",
        "node_modules",
        "7zip-bin",
        platform,
        arch,
        "7za"
      );
      try {
        fs.rmSync(outputPath, { recursive: true, force: true });
      } catch (e) {
        console.log(e);
      }
      // Verifica permissões de execução no Unix
      if (platform === "linux" || platform === "darwin") {
        ensureExecutablePermission(sevenZipPath)
          .then(() =>
            runCompression(sevenZipPath, inputPath, outputPath)
              .then(() => resolve())
              .catch((err) =>
                reject(`${err.message}`)
              )
          )
          .catch((err) =>
            reject(`${err.message}`)
          );
      } else {
        runCompression(sevenZipPath, inputPath, outputPath);
      }
    } else {
      reject("File not found");
    }
  });
};

const runCompression = (sevenZipPath, inputPath, outputPath) => {
  const command = `"${sevenZipPath}" a -t7z "${outputPath}" "${inputPath}" -y`;
  console.log(command);
  return new Promise((resolve, reject) => {
    exec(command)
      .then(() => {
        resolve(
          `File compressed! ${outputPath}`
        );
      })
      .catch((err) => reject(`Error compressing: ${err.message}`));
  });
};
module.exports = { extractFile, compressFile, isCompressed: detectFormat };
