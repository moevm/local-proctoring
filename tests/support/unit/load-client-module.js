import fs from 'node:fs/promises';
import vm from 'node:vm';

/** Evaluate the real ESM graph in an isolated browser-like global scope. No source rewriting. */
export async function loadClientModule(filename, globals = {}, imports = {}) {
  const context = vm.createContext({
    console: { log() {}, error() {} },
    Promise,
    Date,
    Uint8Array,
    DataView,
    TextEncoder,
    TextDecoder,
    Blob,
    File,
    FormData,
    AbortController,
    Headers,
    Response,
    URL,
    setTimeout,
    clearTimeout,
    setInterval: () => 0,
    clearInterval() {},
    ...globals,
  });
  const modules = new Map();
  async function getModule(url) {
    if (modules.has(url.href)) return modules.get(url.href);
    const module = new vm.SourceTextModule(await fs.readFile(url, 'utf8'), {
      context,
      identifier: url.href,
    });
    modules.set(url.href, module);
    return module;
  }
  const entry = await getModule(new URL('../../../client/scripts/' + filename, import.meta.url));
  await entry.link(async (specifier, parent) => {
    if (Object.hasOwn(imports, specifier)) {
      const key = 'mock:' + specifier;
      if (!modules.has(key)) {
        const values = imports[specifier];
        modules.set(
          key,
          new vm.SyntheticModule(
            Object.keys(values),
            function () {
              for (const [name, value] of Object.entries(values)) this.setExport(name, value);
            },
            { context, identifier: key },
          ),
        );
      }
      return modules.get(key);
    }
    return getModule(new URL(specifier, parent.identifier));
  });
  await entry.evaluate();
  return entry.namespace;
}
