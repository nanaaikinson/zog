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

function markdownHrefForLink(link) {
  if (/^(?:[a-z][a-z0-9+.-]*:|#)/i.test(link)) {
    return link;
  }

  return publicPathForPermalink(link);
}

function itemLabel(item, docsById) {
  if (item.label) {
    return item.label;
  }

  if ((item.type === "doc" || item.type === "ref") && docsById.has(item.id)) {
    return docsById.get(item.id).title;
  }

  return undefined;
}

function firstItemLink(item, docsById) {
  if (item.type === "link" && !item.unlisted) {
    return item.href;
  }

  if ((item.type === "doc" || item.type === "ref") && docsById.has(item.id)) {
    return docsById.get(item.id).permalink;
  }

  if (item.type === "category") {
    if (item.href && !item.linkUnlisted) {
      return item.href;
    }

    if (item.link?.type === "generated-index") {
      return item.link.permalink;
    }

    for (const child of item.items ?? []) {
      const link = firstItemLink(child, docsById);

      if (link) {
        return link;
      }
    }
  }

  return undefined;
}

function markdownLinkForItem(item, docsById) {
  if (item.type === "html") {
    return undefined;
  }

  const label = itemLabel(item, docsById);
  const link = firstItemLink(item, docsById);

  if (!label || !link) {
    return undefined;
  }

  return `- [${label}](${markdownHrefForLink(link)})`;
}

function markdownForGeneratedIndex(category, docsById) {
  const links = (category.items ?? [])
    .map((item) => markdownLinkForItem(item, docsById))
    .filter(Boolean)
    .join("\n");

  return (
    [`# ${category.link.title ?? category.label}`, category.link.description, links]
      .filter(Boolean)
      .join("\n\n") + "\n"
  );
}

function collectGeneratedIndexCategories(items, categories = []) {
  for (const item of items ?? []) {
    if (item.type !== "category") {
      continue;
    }

    if (item.link?.type === "generated-index") {
      categories.push(item);
    }

    collectGeneratedIndexCategories(item.items, categories);
  }

  return categories;
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
  const generatedIndexCategories = [];

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

        const docsById = new Map(
          (version.docs ?? []).map((doc) => [doc.id, doc]),
        );

        for (const sidebar of Object.values(version.sidebars ?? {})) {
          for (const category of collectGeneratedIndexCategories(sidebar)) {
            generatedIndexCategories.push({ category, docsById });
          }
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

      for (const { category, docsById } of generatedIndexCategories) {
        const outputPath = outputPathForPermalink(outDir, category.link.permalink);
        const previousSource = seenOutputPaths.get(outputPath);

        if (previousSource) {
          throw new Error(
            `Markdown route collision for ${outputPath}: ${previousSource} and generated index ${category.link.permalink}`,
          );
        }

        seenOutputPaths.set(
          outputPath,
          `generated index ${category.link.permalink}`,
        );

        await fs.mkdir(path.dirname(outputPath), { recursive: true });
        await fs.writeFile(outputPath, markdownForGeneratedIndex(category, docsById));

        headerPaths.push(publicPathForPermalink(category.link.permalink));
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
