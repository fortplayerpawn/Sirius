import {
  Request,
  Response,
  NextFunction,
  RequestHandler,
  Router,
} from "express";
import fs from "node:fs";
import path from "node:path";
import util from "node:util";
import log from "../utils/log";
import Users from "../models/Users";
import verifyToken from "../middleware/verifyToken";
import { getSeason } from "../utils";
import crypto from "node:crypto";

const readdir = util.promisify(fs.readdir);
const readFile = util.promisify(fs.readFile);

interface Custom extends Request {
  rawBody?: any;
}

async function getRequestBody(
  req: Custom,
  res: Response,
  next: NextFunction
): Promise<string> {
  return new Promise((resolve, reject) => {
    if (req.headers["content-length"]) {
      const contentLength = Number(req.headers["content-length"]);

      if (contentLength >= 400000) {
        console.log("File size exceeds the maximum allowed limit (400KB).");
        res.status(403).json({
          error: "File size exceeds the maximum allowed limit (400KB).",
        });
      }
    }

    req.rawBody = "";
    req.setEncoding("latin1");

    req.on("data", (chunk) => {
      req.rawBody += chunk;
    });

    req.on("end", () => {
      next();
    });

    req.on("error", (err: any) => {
      reject(err);
    });
  });
}

export default function initRoute(router: Router): void {
  router.get("/fortnite/api/cloudstorage/system", async (req, res) => {
    res.contentType("application/json");

    const files: any[] = [];
    const cloudstorageDirPath = path.join(
      __dirname,
      "..",
      "common",
      "resources",
      "cloudstorage"
    );

    try {
      const fileNames = await readdir(cloudstorageDirPath);

      for (const fileName of fileNames) {
        if (path.extname(fileName) === ".ini") {
          const filePath = path.join(cloudstorageDirPath, fileName);
          const fileInfo = fs.statSync(filePath);

          files.push({
            uniqueFileName: path.basename(filePath),
            filename: path.basename(filePath),
            hash: "603E6907398C7E74E25C0AE8EC3A03FFAC7C9BB4",
            hash256:
              "973124FFC4A03E66D6A4458E587D5D6146F71FC57F359C8D516E0B12A50AB0D9",
            length: fileInfo.size,
            contentType: "text/plain",
            uploaded: "9999-9999-9999",
            storageType: "S3",
            doNotCache: false,
          });
        }
      }

      res.json(files);
    } catch (error) {
      let err = error as Error;
      log.error(
        `Failed to get CloudStorage: ${err.message}`,
        "cloudstorage:system"
      );
      res.status(500).send("Internal Server Error");
    }
  });

  router.get(
    "/fortnite/api/cloudstorage/system/:filename",
    async (req, res) => {
      res.contentType("application/octet-stream");

      const filename = req.params.filename;
      const filePath = path.join(
        __dirname,
        "..",
        "common",
        "resources",
        "cloudstorage",
        filename
      );

      try {
        if (fs.existsSync(filePath)) {
          const fileContents = await readFile(filePath, "utf-8");
          res.type("text/plain").send(fileContents);
        } else {
          res.status(404).send("File not found");
        }
      } catch (error) {
        let err = error as Error;
        log.error(
          `Failed to get CloudStorage: ${err.message}`,
          `cloudstorage:system:${filename}`
        );
        res.status(500).send("Internal Server Error");
      }
    }
  );

  router.get(
    "/fortnite/api/cloudstorage/user/*/:file",
    verifyToken,
    (req, res) => {
      const clientSettings = path.join(
        process.env.LOCALAPPDATA as string,
        "Sirius",
        "ClientSettings"
      );
      if (!fs.existsSync(clientSettings)) fs.mkdirSync(clientSettings);

      const { file } = req.params;

      if (file !== "ClientSettings.Sav") return res.status(204).end();

      const clientSettingsFile = path.join(
        clientSettings,
        `ClientSettings-${res.locals.user.accountId}.Sav`
      );

      if (fs.existsSync(clientSettingsFile))
        return res.status(204).send(fs.readFileSync(clientSettingsFile));

      res.status(204).end();
    }
  );

  router.get(
    "/fortnite/api/cloudstorage/user/:accountId",
    verifyToken,
    (req, res) => {
      const clientSettings = path.join(
        process.env.LOCALAPPDATA as string,
        "Sirius",
        "ClientSettings"
      );
      if (!fs.existsSync(clientSettings)) fs.mkdirSync(clientSettings);

      const { accountId } = req.params;

      getSeason(req.headers["user-agent"]);

      const clientSettingsFile = path.join(
        clientSettings,
        `ClientSettings-${accountId}.Sav`
      );

      if (fs.existsSync(clientSettingsFile)) {
        const file = fs.readFileSync(clientSettingsFile, "latin1");
        const stats = fs.statSync(clientSettingsFile);

        return res.json([
          {
            uniqueFilename: "ClientSettings.Sav",
            filename: "ClientSettings.Sav",
            hash: crypto.createHash("sha1").update(file).digest("hex"),
            hash256: crypto.createHash("sha256").update(file).digest("hex"),
            length: Buffer.byteLength(file),
            contentType: "application/octet-stream",
            uploaded: stats.mtime,
            storageType: "S3",
            storageIds: {},
            accountId,
            doNotCache: false,
          },
        ]);
      }
      res.json([]).end();
    }
  );

  router.put(
    "/fortnite/api/cloudstorage/user/*/:file",
    verifyToken,
    getRequestBody,
    (req: Custom, res) => {
      if (Buffer.byteLength(req.rawBody) >= 400000) {
        console.log("File size exceeds the maximum allowed limit (400KB).");
        res.status(403).json({
          error: "File size exceeds the maximum allowed limit (400KB).",
        });
      }

      const clientSettings = path.join(
        process.env.LOCALAPPDATA as string,
        "Sirius",
        "ClientSettings"
      );
      if (!fs.existsSync(clientSettings)) fs.mkdirSync(clientSettings);

      const { accountId } = req.params;

      getSeason(req.headers["user-agent"]);

      const clientSettingsFile = path.join(
        clientSettings,
        `ClientSettings-${accountId}.Sav`
      );

      fs.writeFileSync(clientSettingsFile, req.rawBody, "latin1");

      res.status(204).end();
    }
  );
}
