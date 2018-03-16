#!/usr/bin/env node
const fs = require("fs");
const url = require("url");
const puppeteer = require("puppeteer");
const parser = require("yargs-parser");
const {omit} = require("lodash");
const tempy = require("tempy");
const execa = require("execa");
const SVGO = require("svgo");
const plugins = require("./plugins");
const DOMParser = require("xmldom").DOMParser;
const XMLSerializer = require("xmldom").XMLSerializer;

const domParser = new DOMParser();
const serializer = new XMLSerializer();

const svgo = new SVGO({
  plugins
});

const scrollParentSource = fs.readFileSync(require.resolve("scrollparent"));
const REQUIRED = ['url'];

async function main(cli) {
  const missing = REQUIRED.filter(flag => typeof cli.flags[flag] !== "string");

  if (missing.length > 0) {
    throw error(`patternplate-screenshot: ${missing.map(flag => `--${flag}`).join(', ')} are required to be strings`);
  }

  const browser = await puppeteer.launch();
  const page = await browser.newPage();

  await page.goto(cli.flags.url);
  const parsed = url.parse(cli.flags.url);
  const selector = parsed.hash ? parsed.hash.slice(1) : null;

  if (selector) {
    await page.evaluate(selector => {
      const element = document.querySelector(selector);

      if (!element) {
        return;
      }

      eval(scrollParentSource);
      const parent = Scrollparent(element);
      parent.scrollTop = element.offsetParent.offsetTop;
    }, selector);
  }

  const pdfPath = tempy.file();

  await page.pdf({
    printBackground: true,
    path: pdfPath,
    width: typeof cli.flags.width === "string" ? cli.flags.width : "1024px",
    height: typeof cli.flags.height === "string" ? cli.flags.height : "800px"
  });

  await browser.close();

  const svgPath = tempy.file();
  await execa("pdf2svg", [pdfPath, svgPath], {stdin: "inherit", stdout: "inherit"});

  const svg = (await svgo.optimize(fs.readFileSync(svgPath), {path: svgPath})).data;
  const doc = domParser.parseFromString(svg, "image/svg+xml");

  if (typeof cli.flags.viewBox === "string") {
    doc.documentElement.setAttribute("viewBox", cli.flags.viewBox);
  }

  if (typeof cli.flags.preserveAspectRatio === "string") {
    doc.documentElement.setAttribute("preserveAspectRatio", cli.flags.preserveAspectRatio);
  }

  if (typeof cli.flags.width === "string") {
    doc.documentElement.setAttribute("width", cli.flags.width);
  }

  if (cli.flags.width === false) {
    doc.documentElement.removeAttribute("width");
  }

  if (typeof cli.flags.height === "string") {
    doc.documentElement.setAttribute("height", cli.flags.height);
  }

  if (cli.flags.height === false) {
    doc.documentElement.removeAttribute("height");
  }

  const result = serializer.serializeToString(doc);

  if (cli.flags.out) {
    fs.writeFileSync(cli.flags.out, result);
  } else {
    console.log(result);
  }
}

function error(message) {
  const err = new Error(message);
  err.controlled = true;
  return err;
}

function withCli(fn) {
  const argv = parser(process.argv.slice(2));
  const cli = {
    flags: omit(argv, "_"),
    input: argv._
  };
  return () => fn(cli)
    .catch(err => {
      if (err.controlled) {
        console.error(err.message);
      }
      console.error(err);
      process.exit(1);
    });
}

withCli(main)();
