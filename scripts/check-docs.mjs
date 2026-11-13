// Type-checks every ```ts block of README.md and docs/*.md against the package that `pnpm check:docs` builds first.
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const out = ".doc-snippets";
rmSync(out, { recursive: true, force: true });
mkdirSync(out);
const files = ["README.md", ...readdirSync("docs").filter((f) => f.endsWith(".md")).map((f) => join("docs", f))];
let count = 0;
for (const file of files) {
  const blocks = [...readFileSync(file, "utf8").matchAll(/```ts\n([\s\S]*?)```/g)].map((m) => m[1]);
  blocks.forEach((code, index) => {
    writeFileSync(join(out, `${file.replace(/[/.]/g, "_")}_${index + 1}.ts`), `${code}\nexport {};\n`);
    count++;
  });
}
copyFileSync("scripts/doc-snippets.d.ts", join(out, "globals.d.ts"));
writeFileSync(
  join(out, "tsconfig.json"),
  JSON.stringify({
    compilerOptions: { strict: true, noEmit: true, module: "nodenext", moduleResolution: "nodenext", target: "es2022", skipLibCheck: true },
    include: ["*.ts"],
  }),
);
execFileSync(join("node_modules", ".bin", "tsc"), ["-p", out], { stdio: "inherit" });
rmSync(out, { recursive: true, force: true });
console.log(`${count} doc snippets type-check`);
