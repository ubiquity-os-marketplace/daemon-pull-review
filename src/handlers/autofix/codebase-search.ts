import * as fs from "fs";
import * as path from "path";
import { Context } from "../../types";

export class CodebaseSearch {
  octokit: Context["octokit"];
  logger: Context["logger"];
  context: Context;

  constructor(context: Context) {
    this.octokit = context.octokit;
    this.logger = context.logger;
    this.context = context;
  }

  async searchCodebase(query: string, type: "path" | "filename" | "regex"): Promise<string[]> {
    console.log("CodebaseSearch.searchCodebase", query, type);
    if (type === "path") {
      return this._searchCodebaseByPath(query);
    } else if (type === "filename") {
      return this._searchCodebaseByFileName(query);
    } else {
      return this._searchCodebaseByRegex(query);
    }
  }

  private async _searchCodebaseByPath(query: string): Promise<string[]> {
    const results: string[] = [];
    const baseDir = path.resolve(process.cwd(), "repo-clone");
    const walkDir = (dir: string) => {
      const files = fs.readdirSync(dir);
      for (const file of files) {
        const filePath = path.join(dir, file);
        const stat = fs.statSync(filePath);
        if (stat.isDirectory()) {
          walkDir(filePath);
        } else if (filePath.includes(query)) {
          results.push(filePath.replace(baseDir + path.sep, ""));
        }
      }
    };
    walkDir(baseDir);
    return results;
  }

  private async _searchCodebaseByFileName(query: string): Promise<string[]> {
    const results: string[] = [];
    const baseDir = path.resolve(process.cwd(), "repo-clone");
    const walkDir = (dir: string) => {
      const files = fs.readdirSync(dir);
      for (const file of files) {
        const filePath = path.join(dir, file);
        const stat = fs.statSync(filePath);
        if (stat.isDirectory()) {
          walkDir(filePath);
        } else if (file === query) {
          results.push(filePath.replace(baseDir + path.sep, ""));
        }
      }
    };
    walkDir(baseDir);
    return results;
  }

  private async _searchCodebaseByRegex(query: string): Promise<string[]> {
    const results: string[] = [];
    const baseDir = path.resolve(process.cwd(), "repo-clone");
    const regex = new RegExp(query, "g");
    const walkDir = (dir: string) => {
      const files = fs.readdirSync(dir);
      for (const file of files) {
        const filePath = path.join(dir, file);
        const stat = fs.statSync(filePath);
        if (stat.isDirectory()) {
          walkDir(filePath);
        } else {
          const content = fs.readFileSync(filePath, "utf-8");
          if (regex.test(content)) {
            results.push(filePath.replace(baseDir + path.sep, ""));
          }
        }
      }
    };
    walkDir(baseDir);
    return results;
  }

  async _getFileContent(filePaths: string[]): Promise<string> {
    const baseDir = path.resolve(process.cwd(), "repo-clone");
    const contents: string[] = [];
    for (const filePath of filePaths) {
      const content = fs.readFileSync(path.join(baseDir, filePath), "utf-8");
      contents.push(content);
    }

    return contents.join("\n");
  }
}
