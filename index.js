import SFTP from "ssh2-sftp-client";
import { fileURLToPath } from "url";
import path, { dirname } from "path";
import fs from "fs";
import Sequelize from "sequelize";
import { createTunnel } from "tunnel-ssh";

export const __filename = fileURLToPath(import.meta.url);
export const __dirname = dirname(__filename);

export class InteractiveSSH {
  constructor() {
    const this_obj = this;
    this_obj.onEndStream = () => {};
    this_obj.onClose = () => {};
    this_obj.onStream = () => {};
    this_obj.data_stream = "";
    this_obj.is_ready = false;
    this_obj.stream_mode = "default";
    this_obj.ssh_options = {};
    this_obj.isEndStream = () => {
      if (this_obj.stream_mode == "mariadb") {
        return this_obj.data_stream.match(/mariadb.+>/gi);
      } else {
        return this_obj.data_stream.match(/\$|\#/gi);
      }
    };
    this_obj.downloaded_files = [];
    this_obj.onStreamText = (text = "") => {};
  }
  setStreamMode(mode = "default") {
    const this_obj = this;
    this_obj.stream_mode = mode;
  }
  setOnStreamText(func = () => {}) {
    this.onStreamText = func;
  }
  getSSHClient() {
    return this.ssh;
  }
  connect(options) {
    const this_obj = this;
    return new Promise((resolve, reject) => {
      // this_obj.ssh = new Client();
      this_obj.sftp = new SFTP();
      this_obj.ssh = this_obj.sftp.client;
      this_obj.ssh
        .on("ready", () => {
          this_obj.ssh.shell((err, stream) => {
            if (err) throw err;
            this_obj.stream = stream;
            this_obj.onEndStream = () => {
              this_obj.is_ready = true;
              resolve();
            };
            stream
              .on("close", () => {
                this_obj.onClose();
              })
              .on("data", (data) => {
                let data_string = data.toString();
                this_obj.onStreamText(data_string);
                this_obj.data_stream += data_string;
                this_obj.onStream();
                if (this_obj.isEndStream()) {
                  let splited = this_obj.data_stream.split("\n");
                  splited.pop();
                  splited.shift();
                  this_obj.data_stream = "";
                  this_obj.onEndStream(splited.join("\n"));
                }
              });
          });
        })
        .on("error", (err) => {
          reject(err);
          this_obj.onClose();
        });
      // .connect(options);
      this_obj.ssh_options = options;
      this_obj.sftp.connect(this_obj.ssh_options).catch((err2) => {
        reject(err2);
        this_obj.onClose();
      });
    });
  }
  exec(cmd, options = {}) {
    const this_obj = this;
    return new Promise((resolve, reject) => {
      if (this_obj.is_ready) {
        this_obj.stream.write(`${cmd}\n`);
        let password_retry = 1;
        this_obj.onStream = () => {
          if (options.with_error == undefined || options.with_error) {
            if (this_obj.data_stream.match(/error/gi)) {
              let splited = this_obj.data_stream
                .split("\n")
                .filter((val) => val.match(/error/gi));
              reject({ message: `Error -> ${splited.join("\n")}` });
            }
          }
          if (options.password != undefined) {
            if (this_obj.data_stream.match(/password\:/gi)) {
              if (password_retry > 0) {
                password_retry--;
                this_obj.data_stream = "";
                this_obj.stream.write(`${options.password}\n`);
              } else {
                reject({ message: "Password invalid" });
              }
            }
          }
          if (options.confirm != undefined) {
            if (this_obj.data_stream.match(/yes\/no.*\?/gi)) {
              this_obj.data_stream = "";
              this_obj.stream.write(`${options.confirm ? "yes" : "no"}\n`);
            }
          }
        };
        this_obj.onEndStream = (data) => {
          if (options.with_log != undefined && options.with_log)
            console.log(data);
          resolve(data);
        };
        this_obj.onClose = () => {
          reject({ message: "Closed" });
        };
      } else {
        reject({ message: "Not Ready" });
      }
    });
  }
  async download(remote_path, _local_path = "") {
    const this_obj = this;
    if (this_obj.sftp.exists(remote_path)) {
      let path_stat = await this_obj.sftp.stat(remote_path);
      if (path_stat.isDirectory) {
        return { result: false, msg: "Not File" };
      } else if (path_stat.isFile) {
        let filename = path.basename(remote_path);
        let local_path =
          _local_path == ""
            ? path.join(__dirname, "temp", filename)
            : path.join(__dirname, _local_path);
        let localdir = path.dirname(local_path);
        if (!fs.existsSync(localdir))
          fs.mkdirSync(localdir, { recursive: true });
        await this_obj.sftp.fastGet(remote_path, local_path);
        this_obj.downloaded_files.push(local_path);
        return { result: true };
      }
    }
  }
  async upload(remote_path, _local_path = "") {
    const this_obj = this;
    let remote_dir = path.dirname(remote_path);
    if (this_obj.sftp.exists(remote_dir)) {
      let filename = path.basename(remote_path);
      let local_path =
        _local_path == ""
          ? path.join(__dirname, "temp", filename)
          : path.join(__dirname, _local_path);
      if (fs.existsSync(local_path)) {
        await this_obj.sftp.fastPut(local_path, remote_path);
        return { result: true };
      } else {
        return { result: false, msg: `${filename} doesn't exists` };
      }
    }
  }
  async saveFile(dst_local_path, _local_path = "") {
    const this_obj = this;
    let dst_dir = path.dirname(dst_local_path);
    let filename = path.basename(dst_local_path);
    let local_path =
      _local_path == ""
        ? path.join(__dirname, "temp", filename)
        : path.join(__dirname, _local_path);
    if (fs.existsSync(local_path)) {
      if (!fs.existsSync(dst_dir)) fs.mkdirSync(dst_dir, { recursive: true });
      fs.copyFileSync(local_path, dst_local_path);
      return { result: true };
    } else {
      return { result: false, msg: `${filename} doesn't exists` };
    }
  }
  clearCache() {
    const this_obj = this;
    for (let local_path of this_obj.downloaded_files) {
      if (fs.existsSync(local_path)) fs.unlinkSync(local_path);
    }
  }
  close() {
    const this_obj = this;
    if (this_obj.is_ready) {
      this_obj.is_ready = false;
      this_obj.clearCache();
      this_obj.sftp.end();
      if (this_obj.last_sequelize) this_obj.last_sequelize;
      return this_obj.ssh.end();
    } else {
      return true;
    }
  }

  async createSequelizeMysql(sequelize_options) {
    const this_obj = this;
    try {
      if (this_obj.last_sequelize) {
        return this_obj.last_sequelize;
      } else {
        const mysql_host = sequelize_options.host || "localhost";
        const mysql_port = sequelize_options.port || "3306";
        const mysql_user = sequelize_options.user || "";
        const mysql_pass = sequelize_options.password || "";
        const mysql_dbname = sequelize_options.database || "";

        let [server] = await createTunnel(
          { autoClose: false },
          null,
          this_obj.ssh_options,
          { dstAddr: "localhost", dstPort: mysql_port }
        );

        const local_host = server.address().address;
        const local_port = server.address().port;

        let retry_timeout = 5000;
        server.on("connection", () => (retry_timeout = 5000));

        server.on("close", async () => {
          console.log(
            `Retry Tunnel Mysql at ${Math.floor(
              retry_timeout / 1000
            )} Second...`
          );
          setTimeout(async () => {
            [server] = await createTunnel(
              { autoClose: false, host: local_host, port: local_port },
              null,
              this_obj.ssh_options,
              { dstAddr: "localhost", dstPort: mysql_port }
            );
          }, retry_timeout);
        });

        const sequelize = new Sequelize({
          dialect: "mysql",
          host: mysql_host,
          port: local_port,
          username: mysql_user,
          password: mysql_pass,
          database: mysql_dbname,
        });

        await sequelize.authenticate();
        this_obj.last_sequelize = sequelize;
        return sequelize;
      }
    } catch (e) {
      console.error(e.message);
      this_obj.last_sequelize = null;
      return null;
    }
  }
}
