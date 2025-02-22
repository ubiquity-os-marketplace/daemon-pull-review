import { exec, execSync } from "child_process";
import * as fs from "fs";
import * as path from "path";
import { Context } from "../../types";

export class CodebasePrimer {
  logger: Context["logger"];
  context: Context;
  repoUrl: string;
  branch: string;

  constructor(context: Context, repoUrl: string, branch = "main") {
    this.logger = context.logger;
    this.context = context;
    this.repoUrl = repoUrl;
    this.branch = branch;
  }

  /**
   * First checks if the repository is already cloned, if not, it will clone the repository
   * after checking if `git` is installed or not. If not, it will install `git` first.
   */
  async pullCodebase() {
    if (!fs.existsSync("../repo-clone")) {
      if (!this._isGitInstalled()) {
        this.logger.info("Git not installed, installing...");
        await this._installGit();
      }
      this.logger.info("Cloning repository...");
      await this._cloneRepo(this.repoUrl.endsWith(".git") ? this.repoUrl : `${this.repoUrl}.git`);
      this.logger.info("Repository cloned...");
      await this.authenticateAsBot();
      return true;
    } else {
      this.logger.info("Repository already cloned...");
    }
  }

  async authenticateAsBot() {
    this.logger.info("Authenticating as bot...");
    const loggedInStatus = execSync("gh auth status", { stdio: "pipe" }).toString();
    this.logger.info(loggedInStatus);

    execSync(`git config --global user.email "${this.context.env.UBIQUITY_OS_APP_NAME}[bot]@users.noreply.github.com"`);
    execSync(`git config --global user.name "${this.context.env.UBIQUITY_OS_APP_NAME}[bot]"`);

    const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
    if (!token) {
      this.logger.error("GitHub token not found. Please set GH_TOKEN or GITHUB_TOKEN in your environment variables.");
      return;
    }
    execSync(`git config --global credential.helper 'store --file ~/.git-credentials'`);
    fs.writeFileSync(
      path.join(process.env.HOME || process.env.USERPROFILE || "", '.git-credentials'),
      `https://${token}:x-oauth-basic@github.com\n`
    );
  }

  /**
   * Will clone the repository using `git clone` command
   */
  private async _cloneRepo(repoUrl: string): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      this.logger.info("Cloning repository...");
      execSync(`git clone --branch ${this.branch} ${repoUrl} "../repo-clone"`, { stdio: "inherit" });
      resolve();
    });
  }

  /**
   * needs to check if `git clone` is going to work i.e can we clone the repo, is it installed?
   */
  private async _isGitInstalled() {
    return new Promise<void>((resolve, reject) => {
      this.logger.info("Checking if GitHub CLI is installed...");
      exec("gh --version", (error, stdout, stderr) => {
        if (error) {
          this.logger.error(stderr);
          reject(error);
        } else {
          this.logger.info(stdout);
          resolve();
        }
      });
    });
  }

  /**
   * needs to install `git` if not installed to clone the repo
   */
  private async _installGit(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      this.logger.info("Installing Git...");
      exec("sudo apt-get install git", (error, stdout, stderr) => {
        if (error) {
          this.logger.error(stderr);
          reject(error);
        } else {
          this.logger.info(stdout);
          resolve();
        }
      });
    });
  }
}
