import * as esbuild from "esbuild";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";

const watch = process.argv.includes("--watch");
mkdirSync("dist", { recursive: true });

const common = { bundle: true, target: "es2020", minify: !watch, logLevel: "info" };

/** Inline the bundled UI script into the HTML shell (Figma loads ui.html as a single file). */
const inlineUi = {
  name: "inline-ui",
  setup(build) {
    build.onEnd((result) => {
      if (result.errors.length) return;
      const js = result.outputFiles.find((f) => f.path.endsWith(".js")).text;
      const html = readFileSync("src/ui/index.html", "utf8").replace(
        "<!-- SCRIPT -->",
        () => `<script>${js.replace(/<\/script/gi, "<\/script")}</script>`,
      );
      writeFileSync("dist/ui.html", html);
    });
  },
};

const code = await esbuild.context({ ...common, entryPoints: ["src/code.ts"], outfile: "dist/code.js" });
const ui = await esbuild.context({
  ...common,
  entryPoints: ["src/ui/main.ts"],
  outfile: "dist/ui.js",
  write: false,
  plugins: [inlineUi],
});

if (watch) {
  await Promise.all([code.watch(), ui.watch()]);
} else {
  await Promise.all([code.rebuild(), ui.rebuild()]);
  await Promise.all([code.dispose(), ui.dispose()]);
}
