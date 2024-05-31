import { InteractiveSSH } from "./index.js";

const ssh_source = new InteractiveSSH();
try {
  await ssh_source.connect({
    host: "localhost",
    port: "22",
    username: "user",
    password: "pass",
  });

  await ssh_source.exec(`cd ${destination_workdir}`);

  //-- stream for mariadb CLI
  ssh_source.setStreamMode("mariadb");
  await ssh_source.exec(
    `mysql -u${destination_db_user} -p${destination_db_pass}`
  );
  await ssh_source.exec(`use ${destination_db_name}`);
  ssh_source.setStreamMode("default");
  await ssh_source.exec(`exit`);
  //-- stream default
} catch (e) {
  console.error(e.message);
} finally {
  ssh_source.close();
}
