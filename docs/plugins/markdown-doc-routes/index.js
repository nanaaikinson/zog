const fs = require("fs/promises");
const path = require("path");

const START_MARKER = "# BEGIN markdown-doc-routes noindex";
const END_MARKER = "# END markdown-doc-routes noindex";

function resolveSourcePath(siteDir, source) {
  if (!source.startsWith("@site/")) {
    throw new Error(`Unsupported docs source path: ${source}`);
  }

  return path.join(siteDir, source.slice("@site/".length));
}

function outputPathForPermalink(outDir, permalink) {
  const normalized = permalink.replace(/^\/+|\/+$/g, "");
  const relativePath = normalized === "" ? "index.md" : `${normalized}.md`;

  return path.join(outDir, relativePath);
}

function publicPathForPermalink(permalink) {
  const normalized = permalink.replace(/^\/+|\/+$/g, "");

  return normalized === "" ? "/index.md" : `/${normalized}.md`;
}

function shouldEmitDoc(doc) {
  return doc.draft !== true;
}

function replaceGeneratedBlock(content, block) {
  const start = content.indexOf(START_MARKER);
  const end = content.indexOf(END_MARKER);

  if (start !== -1 && end !== -1 && end > start) {
    const before = content.slice(0, start).trimEnd();
    const after = content.slice(end + END_MARKER.length).trimStart();

    return [before, block, after].filter(Boolean).join("\n\n") + "\n";
  }

  return [content.trimEnd(), block].filter(Boolean).join("\n\n") + "\n";
}

function markdownDocRoutesPlugin(context, options = {}) {
  const docsPluginId = options.docsPluginId ?? "default";
  const docs = [];

  return {
    name: "markdown-doc-routes",

    async allContentLoaded({ allContent }) {
      const docsContent = allContent["docusaurus-plugin-content-docs"]?.[docsPluginId];

      if (!docsContent) {
        return;
      }

      for (const version of docsContent.loadedVersions ?? []) {
        for (const doc of version.docs ?? []) {
          docs.push(doc);
        }
      }
    },

    async postBuild({ outDir }) {
      const docsToEmit = docs.filter(shouldEmitDoc);
      const seenOutputPaths = new Map();
      const headerPaths = [];

      for (const doc of docsToEmit) {
        const sourcePath = resolveSourcePath(context.siteDir, doc.source);
        const outputPath = outputPathForPermalink(outDir, doc.permalink);
        const previousSource = seenOutputPaths.get(outputPath);

        if (previousSource) {
          throw new Error(
            `Markdown route collision for ${outputPath}: ${previousSource} and ${doc.source}`,
          );
        }

        seenOutputPaths.set(outputPath, doc.source);

        const markdown = await fs.readFile(sourcePath, "utf8");
        await fs.mkdir(path.dirname(outputPath), { recursive: true });
        await fs.writeFile(outputPath, markdown);

        headerPaths.push(publicPathForPermalink(doc.permalink));
      }

      const headersPath = path.join(outDir, "_headers");
      let headersContent = "";

      try {
        headersContent = await fs.readFile(headersPath, "utf8");
      } catch (error) {
        if (error.code !== "ENOENT") {
          throw error;
        }
      }

      const generatedBlock = [
        START_MARKER,
        ...headerPaths.flatMap((publicPath) => [
          publicPath,
          "  X-Robots-Tag: noindex",
          "",
        ]),
        END_MARKER,
      ].join("\n");

      await fs.writeFile(headersPath, replaceGeneratedBlock(headersContent, generatedBlock));
    },
  };
}

module.exports = markdownDocRoutesPlugin;
