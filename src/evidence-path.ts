// Structural file classification only. Language-specific semantic parsing remains
// optional; these predicates never claim that a file implements correct behavior.
const CODE = /\.(?:[cm]?[jt]sx?|py|rs|go|java|kt|kts|rb|cs|cpp|cc|c|h|hpp|swift|php|scala|ex|exs)$/i;
const TEST = /(^|\/)(test|tests|spec|__tests__)(\/|\.|$)|[._](test|spec)\.[^/]+$|(^|\/)test_[^/]+\.[^/]+$|(^|\/)conftest\.py$/i;
const CONFIG_OR_DECLARATION = /(^|\/)(?:tsconfig|vite\.config|webpack\.config|eslint\.config)|\.(?:config|d)\.[cm]?[jt]s$/i;

export const isCodeFile = (path: string): boolean => CODE.test(path);
export const isTestSupportPath = (path: string): boolean => /(^|\/)conftest\.py$/i.test(path);
export const isPythonPackageMarker = (path: string): boolean => /(^|\/)__init__\.py$/i.test(path);
export const isTestPath = (path: string): boolean => TEST.test(path) && !isTestSupportPath(path);
export const isBehaviorCodeFile = (path: string): boolean => isCodeFile(path) && !CONFIG_OR_DECLARATION.test(path);
export const isImplementationPath = (path: string): boolean => isBehaviorCodeFile(path) && !isTestPath(path) && !isTestSupportPath(path)
  && (/^(?:[^/]+)$/.test(path) || /(^|\/)(src|lib|packages)(\/|$)/i.test(path)
    || (/\.py$/i.test(path) && !/(^|\/)(docs?|examples?|samples?|scripts?|tools|vendor|build|dist|fixtures?|generated|\.venv|venv)(\/|$)/i.test(path)));
