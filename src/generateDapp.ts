import fs from "fs/promises";
import { blue, bold, green, red } from "kolorist";
import { fileURLToPath } from "node:url";
import type { Ora } from "ora";
import ora from "ora";
import path from "path";
import { recordTelemetry } from "./telemetry.js";
// internal files
import type { Selections } from "./types.js";
import { context } from "./utils/context.js";
import { copy, remove } from "./utils/helpers.js";
import { installDependencies } from "./utils/installDependencies.js";
import { createModulePublisherAccount } from "./utils/createModulePublisherAccount.js";
import { setUpEnvVariables } from "./utils/setUpEnvVariables.js";

const spinner = (text) => ora({ text, stream: process.stdout, color: "green" });
let currentSpinner: Ora | null = null;

export async function generateDapp(selection: Selections) {
  const projectName = selection.projectName || "my-aptos-dapp";

  // internal template directory path
  const templateDir = path.resolve(
    fileURLToPath(import.meta.url),
    "../../templates",
    selection.template.path
  );

  // current working directory
  const cwd = process.cwd();

  // target directory - current directory + chosen project name
  const targetDirectory = path.join(cwd, projectName);

  console.log(); // print new line
  const scaffoldingSpinner = spinner(
    `Scaffolding project in ${targetDirectory}`
  ).start();
  currentSpinner = scaffoldingSpinner;

  try {
    // make target directory if not exist
    await fs.mkdir(targetDirectory, { recursive: true });

    // internal template directory files
    const files = await fs.readdir(templateDir);

    // write to file
    const write = async (file: string, content?: string) => {
      // file to copy to target directory
      const targetPath = path.join(targetDirectory, renameFiles[file] ?? file);

      if (content) {
        await fs.writeFile(targetPath, content);
      } else {
        copy(path.join(templateDir, file), targetPath);
      }
    };

    // Map of files to rename on build time
    const renameFiles: Record<string, string | undefined> = {
      // `npm publish` doesnt include the .gitignore file
      _gitignore: ".gitignore",
    };

    // loop over template files and write to target directory
    // ignore .DS_Store, node_modules, package-lock.json, .aptos, build, .env
    await Promise.all(
      files
        .filter(
          (f) =>
            f !== ".DS_Store" &&
            f !== "node_modules" &&
            f !== "package-lock.json" &&
            f !== ".aptos" &&
            f !== "build" &&
            f !== ".env"
        )
        .map((file) => write(file))
    );

    // cd into target directory
    process.chdir(targetDirectory);

    scaffoldingSpinner.succeed();

    // create .env file
    const generateEnvFile = async (additionalContent?: string) => {
      let content = "";

      const accountCreationSpinner = spinner(
        `Creating a module publisher account\n`
      ).start();
      const publisherAccount = await createModulePublisherAccount(selection);
      accountCreationSpinner.succeed();

      content += setUpEnvVariables(selection, publisherAccount);

      await write(
        ".env",
        `${
          additionalContent ? content.concat("\n", additionalContent) : content
        }`
      );
    };

    switch (selection.template.path) {
      case "nft-minting-dapp-template":
        await generateEnvFile(
          `VITE_COLLECTION_CREATOR_ADDRESS=""\n#To fill after you create a collection, will be used for the minting page\nVITE_COLLECTION_ADDRESS=""`
        );
        break;
      case "token-minting-dapp-template":
        await generateEnvFile(
          `VITE_FA_CREATOR_ADDRESS=""\n#To fill after you create a fungible asset, will be used for the minting page\nVITE_FA_ADDRESS=""`
        );
        break;
      case "token-staking-dapp-template":
        await generateEnvFile(
          `VITE_FA_ADDRESS=""\nVITE_REWARD_CREATOR_ADDRESS=""`
        );
        break;
      case "boilerplate-template":
        await generateEnvFile();
        break;
      case "nextjs-boilerplate-template":
        await generateEnvFile();
        break;
      case "clicker-game-tg-mini-app-template":
        if (selection.signingOption === "explicit") {
          copy(
            "frontend/components/explicitSigning/Counter.tsx",
            "frontend/components/Counter.tsx"
          );
          copy(
            "frontend/components/explicitSigning/WalletProvider.tsx",
            "frontend/components/WalletProvider.tsx"
          );
          copy(
            "frontend/components/explicitSigning/WalletSelector.tsx",
            "frontend/components/WalletSelector.tsx"
          );
          const packageJson = JSON.parse(
            await fs.readFile("package.json", "utf-8")
          );
          delete packageJson.dependencies["@mizuwallet-sdk/core"];
          await fs.writeFile(
            "package.json",
            JSON.stringify(packageJson, null, 2)
          );
          remove("frontend/components/seamlessSigning");
          remove("frontend/components/explicitSigning");
          await generateEnvFile();
        } else if (selection.signingOption === "seamless") {
          copy(
            "frontend/components/seamlessSigning/Counter.tsx",
            "frontend/components/Counter.tsx"
          );
          copy(
            "frontend/components/seamlessSigning/WalletProvider.tsx",
            "frontend/components/WalletProvider.tsx"
          );
          copy(
            "frontend/components/seamlessSigning/WalletSelector.tsx",
            "frontend/components/WalletSelector.tsx"
          );
          remove("frontend/components/seamlessSigning");
          remove("frontend/components/explicitSigning");
          await generateEnvFile(`VITE_MIZU_WALLET_APP_ID=""`);
        } else {
          throw new Error(
            `Unsupported signing option: ${selection.signingOption}`
          );
        }
        break;
      default:
        throw new Error("Unsupported template to generate an .env file for");
    }

    let docsInstructions = blue(
      `\n📖 Visit the ${selection.template.name} docs: ${red(
        selection.template.doc
      )}`
    );
    if (selection.template.video) {
      docsInstructions += blue(
        `\n🎬 Check out the walkthrough video: ${red(selection.template.video)}`
      );
    }

    console.log(
      `\nNeed to install dependencies, this might take a while - in the meantime:\n ${docsInstructions}\n`
    );

    const npmSpinner = spinner(`Installing the dependencies\n`).start();

    await installDependencies(context);

    await recordTelemetry({
      command: "npx create-aptos-dapp",
      project_name: selection.projectName,
      template: selection.template.name,
      framework: selection.framework,
      network: selection.network,
      signing_option: selection.signingOption,
    });

    npmSpinner.succeed();
    currentSpinner = npmSpinner;

    // Log next steps
    console.log(
      green("\nSuccess! You're ready to start building your dapp on Aptos.")
    );

    console.log(bold("\nNext steps:"));

    console.log(green(`\nRun: cd ${projectName}`));

    console.log(green(`\nOpen in your favorite IDE && follow the README file`));

    console.log("\n");
  } catch (error: any) {
    currentSpinner?.fail(`Failed to scaffold project: ${error.message}`);
    console.error(error);
  }
}
