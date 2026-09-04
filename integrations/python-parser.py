"""Trusted parser helper: input is JSON data, never imported or executed."""
import ast
import configparser
import json
import sys
import tomllib

LIMIT = 120_000
MAX_ITEMS = 200


def empty(status, limitations):
    return dict(language="python", status=status, parser="python-stdlib-ast/tomllib",
                limitations=limitations, symbols=[], imports=[])


def text(node):
    return ast.unparse(node)[:400] if node is not None else ""


def manifest(content, path):
    if path.endswith("setup.cfg"):
        cfg = configparser.ConfigParser(interpolation=None)
        cfg.read_string(content)
        dependencies = cfg.get("options", "install_requires", fallback="").splitlines()
        if cfg.has_section("options.extras_require"):
            dependencies.extend(line for _, value in cfg.items("options.extras_require") for line in value.splitlines())
        entries = dict(cfg.items("options.entry_points")) if cfg.has_section("options.entry_points") else {}
        scripts = [line.strip().split("=", 1) for value in entries.values() for line in value.splitlines() if "=" in line]
        package_dirs = cfg.get("options", "package_dir", fallback="").splitlines()
        result = empty("parsed", ["Static setup.cfg fields only; interpolation, setup.py, build hooks and dynamic metadata are not evaluated."])
        result["manifest"] = dict(packageName=cfg.get("metadata", "name", fallback=""), dependencies=[x.strip() for x in dependencies if x.strip()],
            developmentDependencies=[], scripts=[x[0].strip() for x in scripts], entryTargets=[x[1].strip() for x in scripts], workspacePatterns=[],
            importRoots=[x.split("=", 1)[1].strip() for x in package_dirs if x.strip().startswith("=")], format="setup.cfg", completeness="partial")
        return result
    root = tomllib.loads(content)
    project = root.get("project", {})
    if not isinstance(project, dict):
        raise ValueError("invalid project table")
    strings = lambda xs: [x for x in xs if isinstance(x, str)] if isinstance(xs, list) else []
    groups = root.get("dependency-groups", {})
    groups = groups if isinstance(groups, dict) else {}
    optional = project.get("optional-dependencies", {})
    optional = optional if isinstance(optional, dict) else {}
    scripts = project.get("scripts", {})
    scripts = scripts if isinstance(scripts, dict) else {}
    gui = project.get("gui-scripts", {})
    gui = gui if isinstance(gui, dict) else {}
    entry = {**scripts, **gui}
    tool = root.get("tool", {})
    tool = tool if isinstance(tool, dict) else {}
    poetry = tool.get("poetry", {})
    poetry = poetry if isinstance(poetry, dict) else {}
    result = empty("parsed", ["Static project metadata only; build hooks, dynamic metadata and group includes are not evaluated."])
    roots = []
    setuptools = tool.get("setuptools", {})
    if isinstance(setuptools, dict):
        packages = setuptools.get("packages", {})
        find = packages.get("find", {}) if isinstance(packages, dict) else {}
        if isinstance(find, dict):
            roots.extend(strings(find.get("where", [])))
        package_dir = setuptools.get("package-dir", {})
        if isinstance(package_dir, dict) and isinstance(package_dir.get(""), str):
            roots.append(package_dir[""])
    poetry_dependencies = []
    poetry_development = []
    def constraints(table):
        if not isinstance(table, dict):
            return []
        return [name + " " + (value if isinstance(value, str) else json.dumps(value, sort_keys=True))
                for name, value in table.items() if name != "python"]
    if poetry:
        poetry_dependencies = constraints(poetry.get("dependencies", {}))
        poetry_development = constraints(poetry.get("dev-dependencies", {}))
        for group in poetry.get("group", {}).values():
            if isinstance(group, dict):
                poetry_development.extend(constraints(group.get("dependencies", {})))
        for package in poetry.get("packages", []):
            if isinstance(package, dict) and isinstance(package.get("from"), str):
                roots.append(package["from"])
        entry = {**poetry.get("scripts", {}), **entry}
        result["limitations"].append("Poetry constraints are preserved as observations, not converted to installable PEP 508 requirements.")
    partial = bool(project.get("dynamic") or poetry or any(isinstance(x, dict) for xs in groups.values() if isinstance(xs, list) for x in xs))
    result["manifest"] = dict(
        dependencies=sorted(set(poetry_dependencies + strings(project.get("dependencies", [])) +
                                [x for xs in optional.values() for x in strings(xs)]))[:MAX_ITEMS],
        developmentDependencies=sorted(set(poetry_development + [x for xs in groups.values() for x in strings(xs)]))[:MAX_ITEMS],
        scripts=sorted(entry)[:MAX_ITEMS], workspacePatterns=[],
        entryTargets=sorted(set(x for x in entry.values() if isinstance(x, str)))[:MAX_ITEMS],
        importRoots=sorted(set(roots)), format="pep621+poetry" if project and poetry else "poetry" if poetry else "pep621" if project else "unknown",
        completeness="unsupported" if not project and not poetry else "partial" if partial else "complete",
    )
    if isinstance(project.get("name"), str):
        result["manifest"]["packageName"] = project["name"]
    elif isinstance(poetry.get("name"), str):
        result["manifest"]["packageName"] = poetry["name"]
    return result


def analyze(content):
    tree = ast.parse(content, filename="<reference>")
    result = empty("parsed", ["Static syntax only; annotations, decorators, conditional imports, assertions and exceptions are not evaluated. Dynamic imports, call graphs and runtime types are unresolved."])
    aliases = {}
    alias_lines = {}
    import_counts = {}
    conflicting = set()
    # Conservative lexical binding check: shadowed/rebound aliases are not
    # promoted to framework traits, even if one occurrence might be valid.
    for node in ast.walk(tree):
        if isinstance(node, ast.Name) and isinstance(node.ctx, (ast.Store, ast.Del)):
            conflicting.add(node.id)
        elif isinstance(node, ast.arg):
            conflicting.add(node.arg)
        elif isinstance(node, (ast.ClassDef, ast.FunctionDef, ast.AsyncFunctionDef)):
            conflicting.add(node.name)
        elif isinstance(node, (ast.Import, ast.ImportFrom)):
            for item in node.names:
                bound = item.asname or (item.name.split(".")[0] if isinstance(node, ast.Import) else item.name)
                import_counts[bound] = import_counts.get(bound, 0) + 1
    conflicting.update(name for name, count in import_counts.items() if count > 1)
    for node in tree.body:
        if isinstance(node, ast.Import):
            for a in node.names:
                aliases[a.asname or a.name.split(".")[0]] = a.name if a.asname else a.name.split(".")[0]
                alias_lines[a.asname or a.name.split(".")[0]] = node.lineno
        elif isinstance(node, ast.ImportFrom) and node.level == 0:
            for a in node.names:
                aliases[a.asname or a.name] = (node.module or "") + "." + a.name
                alias_lines[a.asname or a.name] = node.lineno

    def canonical(node):
        node = node.func if isinstance(node, ast.Call) else node
        node = node.value if isinstance(node, ast.Subscript) else node
        raw = text(node)
        head, dot, tail = raw.partition(".")
        if head in conflicting or alias_lines.get(head, 0) > getattr(node, "lineno", 0):
            return "unresolved:" + raw
        return aliases.get(head, head) + (dot + tail if dot else "")

    result["exports"] = dict(names=[], status="implicit")
    for node in tree.body:
        if isinstance(node, (ast.ClassDef, ast.FunctionDef, ast.AsyncFunctionDef)) and not node.name.startswith("_"):
            result["exports"]["names"].append(node.name)
        elif isinstance(node, (ast.Import, ast.ImportFrom)):
            result["exports"]["names"].extend(a.asname or (a.name.split(".")[0] if isinstance(node, ast.Import) else a.name) for a in node.names if a.name != "*")
        elif isinstance(node, (ast.Assign, ast.AnnAssign)):
            targets = node.targets if isinstance(node, ast.Assign) else [node.target]
            result["exports"]["names"].extend(x.id for x in targets if isinstance(x, ast.Name))
    result["exports"]["names"] = sorted(set(x for x in result["exports"]["names"] if not x.startswith("_")))
    for node in tree.body:
        targets = node.targets if isinstance(node, ast.Assign) else [node.target] if isinstance(node, (ast.AnnAssign, ast.AugAssign)) else []
        if any(isinstance(target, ast.Name) and target.id == "__all__" for target in targets):
            value = node.value
            literal = isinstance(value, (ast.List, ast.Tuple)) and all(isinstance(x, ast.Constant) and isinstance(x.value, str) for x in value.elts)
            if literal and not isinstance(node, ast.AugAssign):
                result["exports"] = dict(names=[x.value for x in value.elts], status="static")
            elif literal and isinstance(node, ast.AugAssign) and isinstance(node.op, ast.Add) and result["exports"]["status"] == "static":
                result["exports"]["names"].extend(x.value for x in value.elts)
            else:
                result["exports"] = dict(names=[], status="dynamic")
    # Conditional writes or mutation calls invalidate a literal-only export list.
    def module_nodes(node):
        for child in ast.iter_child_nodes(node):
            if isinstance(child, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef, ast.Lambda)):
                continue
            yield child
            yield from module_nodes(child)

    direct = {id(node) for node in tree.body}
    for node in module_nodes(tree):
        targets = node.targets if isinstance(node, ast.Assign) else [node.target] if isinstance(node, (ast.AnnAssign, ast.AugAssign)) else []
        if (id(node) not in direct and any(isinstance(x, ast.Name) and x.id == "__all__" for x in targets)) or (isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute) and isinstance(node.func.value, ast.Name) and node.func.value.id == "__all__"):
            result["exports"] = dict(names=[], status="dynamic")

    def body_nodes(node):
        for child in ast.iter_child_nodes(node):
            if isinstance(child, (ast.ClassDef, ast.FunctionDef, ast.AsyncFunctionDef, ast.Lambda)):
                continue
            yield child
            yield from body_nodes(child)

    class Visitor(ast.NodeVisitor):
        def __init__(self):
            self.scope = []
            self.context = []

        def under(self, label, nodes):
            self.context.append(label)
            for node in nodes:
                self.visit(node)
            self.context.pop()

        def visit_If(self, node):
            label = "type-checking" if canonical(node.test) == "typing.TYPE_CHECKING" else "if"
            self.under(label + ":" + text(node.test), node.body)
            self.under("else:" + text(node.test), node.orelse)

        def visit_Try(self, node):
            self.under("try", node.body)
            for handler in node.handlers:
                self.under("except:" + text(handler.type), handler.body)
            self.under("try-else", node.orelse)
            self.under("finally", node.finalbody)

        visit_TryStar = visit_Try

        def visit_For(self, node):
            self.under("loop:" + text(node.iter), node.body)
            self.under("loop-else", node.orelse)

        visit_AsyncFor = visit_For

        def visit_While(self, node):
            self.under("while:" + text(node.test), node.body)
            self.under("while-else", node.orelse)

        def visit_With(self, node):
            self.under("with:" + ",".join(text(x.context_expr) for x in node.items), node.body)

        visit_AsyncWith = visit_With

        def visit_Match(self, node):
            for case in node.cases:
                self.under("match:" + text(node.subject) + ":" + text(case.pattern) + (":guard:" + text(case.guard) if case.guard else ""), case.body)

        def declaration(self, node):
            name = ".".join(self.scope + [node.name])
            decorators = [text(d) for d in node.decorator_list]
            kind = "class" if isinstance(node, ast.ClassDef) else "async-function" if isinstance(node, ast.AsyncFunctionDef) else "function"
            signature = "class " + node.name if kind == "class" else ("async " if kind == "async-function" else "") + "def " + node.name + "(" + text(node.args) + ")" + (" -> " + text(node.returns) if node.returns else "")
            observed = list(body_nodes(node))
            resolved_decorators = [canonical(d) for d in node.decorator_list]
            role = "fixture" if "pytest.fixture" in resolved_decorators or "fixture" in resolved_decorators else "test" if node.name.startswith("test_") or (kind == "class" and node.name.startswith("Test")) else "implementation"
            bases = [canonical(b) for b in node.bases] if kind == "class" else []
            traits = [trait for marker, trait in [("typing.Protocol", "protocol"), ("abc.ABC", "abstract-class"), ("typing.TypedDict", "typed-dict")] if marker in bases]
            if kind == "class" and any(k.arg == "metaclass" and canonical(k.value) == "abc.ABCMeta" for k in node.keywords):
                traits.append("abstract-class")
            if "dataclasses.dataclass" in resolved_decorators or "dataclass" in resolved_decorators:
                traits.append("dataclass")
            if "abc.abstractmethod" in resolved_decorators:
                traits.append("abstract-method")
            fields = []
            if kind == "class":
                for statement in node.body:
                    if isinstance(statement, ast.AnnAssign) and isinstance(statement.target, ast.Name):
                        fields.append(dict(name=statement.target.id, annotation=text(statement.annotation), defaultValue=text(statement.value), line=statement.lineno, kind="class"))
                    elif isinstance(statement, ast.Assign):
                        for target in statement.targets:
                            if isinstance(target, ast.Name):
                                fields.append(dict(name=target.id, annotation="", defaultValue=text(statement.value), line=statement.lineno, kind="class"))
                    elif isinstance(statement, (ast.FunctionDef, ast.AsyncFunctionDef)) and statement.name == "__init__":
                        for assignment in body_nodes(statement):
                            targets = assignment.targets if isinstance(assignment, ast.Assign) else [assignment.target] if isinstance(assignment, ast.AnnAssign) else []
                            for target in targets:
                                if isinstance(target, ast.Attribute) and isinstance(target.value, ast.Name) and target.value.id == "self":
                                    fields.append(dict(name=target.attr, annotation=text(assignment.annotation) if isinstance(assignment, ast.AnnAssign) else "", defaultValue=text(assignment.value), line=assignment.lineno, kind="instance"))
            parameters = [a.arg for a in node.args.posonlyargs + node.args.args + node.args.kwonlyargs] if kind != "class" else []
            fixture_name = node.name
            requested = []
            parametrized = set()
            for decorator in node.decorator_list:
                if isinstance(decorator, ast.Call):
                    if canonical(decorator) == "pytest.mark.parametrize" and decorator.args:
                        arg = decorator.args[0]
                        names = [x.strip() for x in arg.value.split(",")] if isinstance(arg, ast.Constant) and isinstance(arg.value, str) else [x.value for x in arg.elts if isinstance(x, ast.Constant) and isinstance(x.value, str)] if isinstance(arg, (ast.List, ast.Tuple)) else []
                        indirect = next((k.value for k in decorator.keywords if k.arg == "indirect"), None)
                        indirect_names = names if isinstance(indirect, ast.Constant) and indirect.value is True else [x.value for x in indirect.elts if isinstance(x, ast.Constant) and isinstance(x.value, str)] if isinstance(indirect, (ast.List, ast.Tuple)) else []
                        parametrized.update(x for x in names if x not in indirect_names)
                    if canonical(decorator) == "pytest.mark.usefixtures":
                        requested.extend(x.value for x in decorator.args if isinstance(x, ast.Constant) and isinstance(x.value, str))
                    if role == "fixture":
                        for keyword in decorator.keywords:
                            if keyword.arg == "name" and isinstance(keyword.value, ast.Constant) and isinstance(keyword.value.value, str):
                                fixture_name = keyword.value.value
            if role in ("test", "fixture"):
                requested.extend(x for x in parameters if x not in {"self", "cls"} and x not in parametrized)
            meaningful_body = [n for n in node.body if not isinstance(n, ast.Pass) and not (isinstance(n, ast.Expr) and isinstance(n.value, ast.Constant))]
            result["symbols"].append(dict(
                name=name, kind=kind, startLine=min([node.lineno] + [d.lineno for d in node.decorator_list]),
                endLine=node.end_lineno, signature=signature[:800], decorators=decorators[:20],
                bases=[text(b) for b in node.bases][:20] if kind == "class" else [],
                raises=sorted(set(text(n.exc) if n.exc else "re-raise" for n in observed if isinstance(n, ast.Raise)))[:20],
                catches=sorted(set(text(n.type) if n.type else "bare-except" for n in observed if isinstance(n, ast.ExceptHandler)))[:20],
                assertionCount=sum(isinstance(n, ast.Assert) for n in observed), role=role,
                traits=traits, fields=fields[:100], parameters=parameters,
                fixtureName=fixture_name if role == "fixture" else "", fixtureRequests=sorted(set(requested)), hasBody=bool(meaningful_body),
            ))
            self.scope.append(node.name)
            self.generic_visit(node)
            self.scope.pop()

        visit_ClassDef = declaration
        visit_FunctionDef = declaration
        visit_AsyncFunctionDef = declaration

        def visit_Import(self, node):
            for alias in node.names:
                result["imports"].append(dict(module=alias.name, names=[], level=0, line=node.lineno,
                    aliases=[dict(name=alias.name, asName=alias.asname)], scope=".".join(self.scope) or "module", context=list(self.context)))

        def visit_ImportFrom(self, node):
            result["imports"].append(dict(module=node.module or "", names=[a.name for a in node.names], level=node.level, line=node.lineno,
                aliases=[dict(name=a.name, asName=a.asname) for a in node.names], scope=".".join(self.scope) or "module", context=list(self.context)))

    Visitor().visit(tree)
    if len(result["symbols"]) > MAX_ITEMS or len(result["imports"]) > MAX_ITEMS:
        result["limitations"].append("Observation count truncated to 200 symbols and 200 imports.")
    result["symbols"] = result["symbols"][:MAX_ITEMS]
    result["imports"] = result["imports"][:MAX_ITEMS]
    return result


try:
    data = json.loads(sys.stdin.buffer.read(1_000_001))
    content = data["content"]
    if not isinstance(content, str) or len(content) > LIMIT:
        result = empty("budget-exceeded", ["Source exceeds parser character budget."])
    else:
        path = data["path"].lower()
        result = manifest(content, path) if path.endswith(("pyproject.toml", "setup.cfg")) else analyze(content)
except (SyntaxError, ValueError, TypeError, KeyError, AttributeError, configparser.Error, RecursionError, MemoryError):
    result = empty("invalid", ["Syntax or input unsupported by the installed Python parser; no partial AST claimed."])
# Syntax metadata has its own context budget, independent of input/source slices.
if len(json.dumps(result, ensure_ascii=True)) > 32_000:
    result["limitations"].append("Syntax metadata truncated to a 32000-character JSON budget.")
    while len(json.dumps(result, ensure_ascii=True)) > 32_000 and result["symbols"]:
        result["symbols"].pop()
    while len(json.dumps(result, ensure_ascii=True)) > 32_000 and result["imports"]:
        result["imports"].pop()
    if len(json.dumps(result, ensure_ascii=True)) > 32_000:
        result = empty("budget-exceeded", ["Manifest metadata exceeds output budget."])
print(json.dumps(result, ensure_ascii=True))
