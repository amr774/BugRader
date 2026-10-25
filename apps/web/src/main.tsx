import React, { useEffect, useState, FormEvent, useCallback } from "react";
import { createRoot } from "react-dom/client";
import {
  BrowserRouter,
  Link,
  NavLink,
  Route,
  Routes,
  useNavigate,
  useParams,
  useSearchParams,
} from "react-router-dom";
import {
  Activity,
  ArrowLeft,
  ArrowRight,
  Check,
  ChevronRight,
  Code2,
  Copy,
  FolderGit2,
  LayoutDashboard,
  LogOut,
  Plus,
  Radar,
  RefreshCw,
  Search,
  Settings,
  ShieldCheck,
  TriangleAlert,
  Zap,
} from "lucide-react";
import { BugRadar } from "@bugradar/browser-sdk";
import {
  api,
  API,
  type Project,
  type Issue,
  type Occurrence,
  type Page,
} from "./api";
import "./styles.css";
const date = (v?: string) => (v ? new Date(v).toLocaleString() : "—");
const number = (v: number) => v.toLocaleString();
const statuses = ["OPEN", "IN_PROGRESS", "RESOLVED", "IGNORED"];
const label = (s: string) => s.replaceAll("_", " ").toLowerCase();
function ErrorBox({ error }: { error: string }) {
  return error ? (
    <div className="notice error" role="alert">
      {error}
    </div>
  ) : null;
}
function Empty({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="empty">
      <Radar size={35} />
      <h3>{title}</h3>
      <p>{children}</p>
    </div>
  );
}
function Badge({ status }: { status: string }) {
  return (
    <span className={`badge ${status.toLowerCase()}`}>
      <i />
      {label(status)}
    </span>
  );
}
function CopyButton({ text }: { text: string }) {
  const [state, setState] = useState("");
  return (
    <button
      className="secondary small"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setState("Copied");
        } catch {
          setState("Copy unavailable; select the text");
        }
      }}
    >
      {state === "Copied" ? <Check size={14} /> : <Copy size={14} />}{" "}
      {state || "Copy"}
    </button>
  );
}
function Pager({
  page,
  total,
  limit,
  onChange,
}: {
  page: number;
  total: number;
  limit: number;
  onChange: (p: number) => void;
}) {
  return (
    <div className="pager">
      <span>
        {total === 0
          ? "No results"
          : `${(page - 1) * limit + 1}–${Math.min(page * limit, total)} of ${number(total)}`}
      </span>
      <div>
        <button
          className="secondary small"
          disabled={page <= 1}
          onClick={() => onChange(page - 1)}
        >
          Previous
        </button>
        <span>Page {page}</span>
        <button
          className="secondary small"
          disabled={page * limit >= total}
          onClick={() => onChange(page + 1)}
        >
          Next
        </button>
      </div>
    </div>
  );
}
function useLoad<T>(path: string) {
  const [data, setData] = useState<T>();
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [version, setVersion] = useState(0);
  const reload = useCallback(() => setVersion((v) => v + 1), []);
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    api<T>(path)
      .then((d) => {
        if (active) setData(d);
      })
      .catch((e) => {
        if (active) setError(e.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [path, version]);
  return { data, error, loading, reload };
}
function App() {
  const [user, setUser] = useState<{ email: string } | null>();
  const [error, setError] = useState("");
  useEffect(() => {
    api("/auth/me")
      .then(setUser)
      .catch(() => setUser(null));
  }, []);
  if (user === undefined)
    return (
      <div className="boot">
        <Radar /> Loading BugRadar…
      </div>
    );
  if (!user) return <Auth onAuth={setUser} />;
  return (
    <div className="shell">
      <aside className="sidebar">
        <Link className="brand" to="/">
          <span className="brand-icon">
            <Radar size={24} />
          </span>
          BugRadar<span className="beta">BETA</span>
        </Link>
        <div className="workspace">
          <span className="avatar">P</span>
          <div>
            Personal workspace<small>Developer workspace</small>
          </div>
          <ShieldCheck size={16} />
        </div>
        <div className="nav-caption">MONITOR</div>
        <nav>
          <NavLink to="/" end>
            <LayoutDashboard size={18} />
            Overview
          </NavLink>
          <NavLink to="/issues">
            <TriangleAlert size={18} />
            Issues
          </NavLink>
          <NavLink to="/projects">
            <FolderGit2 size={18} />
            Projects
          </NavLink>
          <NavLink to="/demo">
            <Code2 size={18} />
            SDK playground
          </NavLink>
        </nav>
        <div className="sidebar-note">
          <span className="live-dot" /> Your errors. In focus.
          <p>Connect an application to start catching what matters.</p>
        </div>
        <div className="account">
          <span className="avatar purple">{user.email[0].toUpperCase()}</span>
          <div title={user.email}>
            {user.email}
            <small>Personal account</small>
          </div>
          <button
            className="icon"
            aria-label="Log out"
            onClick={async () => {
              try {
                await api("/auth/logout", "POST");
                setUser(null);
              } catch (e) {
                setError((e as Error).message);
              }
            }}
          >
            <LogOut size={17} />
          </button>
        </div>
      </aside>
      <main>
        <div className="topbar">
          <span>
            <span className="live-dot" /> Error monitoring
          </span>
          <span>
            Personal workspace <ChevronRight size={14} />
          </span>
        </div>
        <div className="content">
          <ErrorBox error={error} />
          <Routes>
            <Route path="/" element={<Overview />} />
            <Route path="/issues" element={<Issues />} />
            <Route path="/issues/:id" element={<IssueDetail />} />
            <Route path="/projects" element={<Projects />} />
            <Route path="/projects/:id" element={<ProjectSettings />} />
            <Route path="/demo" element={<Demo />} />
            <Route
              path="*"
              element={
                <Empty title="Page not found">
                  <Link to="/">Return to overview</Link>
                </Empty>
              }
            />
          </Routes>
        </div>
        <footer>
          BugRadar <span>Built for the moments your code has other plans.</span>
        </footer>
      </main>
    </div>
  );
}
function Auth({ onAuth }: { onAuth: (u: { email: string }) => void }) {
  const [register, setRegister] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setBusy(true);
    setError("");
    try {
      onAuth(
        await api(`/auth/${register ? "register" : "login"}`, "POST", {
          email: form.get("email"),
          password: form.get("password"),
        }),
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="auth">
      <section className="auth-story">
        <div className="brand">
          <span className="brand-icon">
            <Radar />
          </span>
          BugRadar
        </div>
        <span className="eyebrow">LESS NOISE. MORE SIGNAL.</span>
        <h1>
          Find the error.
          <br />
          <span>Get back to building.</span>
        </h1>
        <p>
          A clear view of what breaks, where it happens, and what needs your
          attention.
        </p>
        <div className="signal-art" aria-hidden="true">
          <div />
          <div />
          <div />
          <Radar size={100} />
          <span className="signal-point" />
        </div>
        <div className="auth-features">
          <span>
            <Activity size={17} /> Automatic error capture
          </span>
          <span>
            <FolderGit2 size={17} /> Intelligent issue grouping
          </span>
          <span>
            <ShieldCheck size={17} /> Your projects, private
          </span>
        </div>
      </section>
      <section className="auth-panel">
        <div className="auth-form">
          <span className="eyebrow">YOUR DEVELOPER WORKSPACE</span>
          <h2>{register ? "Start catching errors" : "Welcome back"}</h2>
          <p>
            {register
              ? "Create your account. Connect your first project."
              : "Sign in to see what needs your attention."}
          </p>
          <form onSubmit={submit}>
            <label>
              Email address
              <input
                name="email"
                type="email"
                placeholder="you@company.com"
                required
                autoComplete="email"
                maxLength={254}
              />
            </label>
            <label>
              Password
              <input
                name="password"
                type="password"
                placeholder="At least 12 characters"
                required
                minLength={12}
                maxLength={128}
                autoComplete={register ? "new-password" : "current-password"}
              />
            </label>
            <ErrorBox error={error} />
            <button disabled={busy}>
              {busy ? "Please wait…" : register ? "Create account" : "Sign in"}
              <ArrowRight size={16} />
            </button>
          </form>
          <p className="auth-switch">
            {register ? "Already have an account?" : "New to BugRadar?"}{" "}
            <button
              className="text-button"
              onClick={() => {
                setRegister(!register);
                setError("");
              }}
            >
              {register ? "Sign in" : "Create an account"}
            </button>
          </p>
          <div className="privacy-note">
            <ShieldCheck size={17} /> Secure, HTTP-only cookie sessions. No
            trackers.
          </div>
        </div>
      </section>
    </div>
  );
}
function Header({
  eyebrow,
  title,
  description,
  children,
}: {
  eyebrow: string;
  title: string;
  description: string;
  children?: React.ReactNode;
}) {
  return (
    <header className="page-heading">
      <div>
        <span className="eyebrow">{eyebrow}</span>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      <div className="heading-actions">{children}</div>
    </header>
  );
}
function IssueTable({ items }: { items: Issue[] }) {
  return (
    <div className="table-scroll">
      <table>
        <thead>
          <tr>
            <th>Issue</th>
            <th>Status</th>
            <th>Events</th>
            <th>Last seen</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {items.map((i) => (
            <tr key={i.id}>
              <td>
                <Link className="issue-title" to={`/issues/${i.id}`}>
                  <span className="error-symbol">
                    <TriangleAlert size={16} />
                  </span>
                  <div>
                    <strong>
                      {i.name}: {i.message}
                    </strong>
                    <small>
                      {i.projectName} <span> / </span>{" "}
                      {i.environments?.join(", ")}
                    </small>
                  </div>
                </Link>
              </td>
              <td>
                <Badge status={i.status} />
              </td>
              <td className="mono">{number(i.count)}</td>
              <td className="muted nowrap">{date(i.lastSeen)}</td>
              <td>
                <Link aria-label={`View ${i.message}`} to={`/issues/${i.id}`}>
                  <ChevronRight size={17} />
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
function Overview() {
  const { data, error, loading, reload } = useLoad<{
    projects: number;
    issues: number;
    events: number;
    open: number;
    recent: number;
  }>("/overview");
  const recent = useLoad<Page<Issue>>("/issues?limit=6");
  return (
    <>
      <Header
        eyebrow="WORKSPACE OVERVIEW"
        title="A clearer picture of your apps."
        description="Track errors, find the context, and keep moving forward."
      >
        <button
          className="secondary"
          onClick={() => {
            reload();
            recent.reload();
          }}
        >
          <RefreshCw size={15} />
          Refresh
        </button>
        <Link className="button" to="/projects">
          <Plus size={16} />
          New project
        </Link>
      </Header>
      <ErrorBox error={error} />
      <div className="stats">
        {[
          [
            "Unresolved issues",
            data?.open,
            TriangleAlert,
            "Needs your attention",
          ],
          [
            "Events · last 24 hours",
            data?.recent,
            Activity,
            "Received by the server",
          ],
          ["Total events", data?.events, Zap, "Across all your projects"],
          [
            "Connected projects",
            data?.projects,
            FolderGit2,
            "In your workspace",
          ],
        ].map(([title, value, Icon, note]) => {
          const I = Icon as typeof Activity;
          return (
            <article className="stat" key={String(title)}>
              <div>
                {String(title)}
                <I size={17} />
              </div>
              <strong>
                {loading
                  ? "—"
                  : value === undefined
                    ? "—"
                    : number(Number(value))}
              </strong>
              <small>{String(note)}</small>
            </article>
          );
        })}
      </div>
      <section className="panel">
        <div className="panel-heading">
          <div>
            <h2>Recently seen issues</h2>
            <p>The latest signals from your applications.</p>
          </div>
          <Link className="text-link" to="/issues">
            View all issues <ArrowRight size={15} />
          </Link>
        </div>
        <ErrorBox error={recent.error} />
        {recent.loading ? (
          <p className="loading">Loading issues…</p>
        ) : recent.data?.items.length ? (
          <IssueTable items={recent.data.items} />
        ) : (
          <Empty title="All quiet on your radar">
            Create a project and install the SDK to receive your first error.{" "}
            <Link to="/projects">Set up a project →</Link>
          </Empty>
        )}
      </section>
      <div className="onboarding">
        <span className="onboarding-icon">
          <Code2 size={25} />
        </span>
        <div>
          <h3>From an exception to an answer.</h3>
          <p>
            Connect the lightweight browser SDK, then use the playground to send
            a real event.
          </p>
        </div>
        <Link className="secondary button" to="/demo">
          Open playground
          <ArrowRight size={16} />
        </Link>
      </div>
    </>
  );
}
function Filters({
  params,
  setParams,
  projects,
  withStatus = true,
}: {
  params: URLSearchParams;
  setParams: (p: URLSearchParams) => void;
  projects?: Project[];
  withStatus?: boolean;
}) {
  const update = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    value ? next.set(key, value) : next.delete(key);
    next.delete("page");
    setParams(next);
  };
  return (
    <div className="filters">
      {withStatus && (
        <>
          <label className="search-field">
            <Search size={16} />
            <input
              aria-label="Search issues"
              placeholder="Search error messages…"
              value={params.get("search") ?? ""}
              onChange={(e) => update("search", e.target.value)}
            />
          </label>
          <select
            aria-label="Project"
            value={params.get("projectId") ?? ""}
            onChange={(e) => update("projectId", e.target.value)}
          >
            <option value="">All projects</option>
            {projects?.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <select
            aria-label="Status"
            value={params.get("status") ?? ""}
            onChange={(e) => update("status", e.target.value)}
          >
            <option value="">All statuses</option>
            {statuses.map((s) => (
              <option key={s} value={s}>
                {label(s)}
              </option>
            ))}
          </select>
        </>
      )}
      <input
        aria-label="Environment"
        placeholder="Environment"
        value={params.get("environment") ?? ""}
        onChange={(e) => update("environment", e.target.value)}
      />
      <label className="date-filter">
        From
        <input
          type="date"
          value={params.get("from")?.slice(0, 10) ?? ""}
          onChange={(e) =>
            update(
              "from",
              e.target.value ? `${e.target.value}T00:00:00.000Z` : "",
            )
          }
        />
      </label>
      <label className="date-filter">
        To
        <input
          type="date"
          value={params.get("to")?.slice(0, 10) ?? ""}
          onChange={(e) =>
            update(
              "to",
              e.target.value ? `${e.target.value}T23:59:59.999Z` : "",
            )
          }
        />
      </label>
      {withStatus && (
        <select
          aria-label="Sort by"
          value={params.get("sort") ?? "lastSeen"}
          onChange={(e) => update("sort", e.target.value)}
        >
          <option value="lastSeen">Last seen</option>
          <option value="count">Most frequent</option>
        </select>
      )}
      {params.size > 0 && (
        <button
          className="text-button"
          onClick={() => setParams(new URLSearchParams())}
        >
          Clear filters
        </button>
      )}
    </div>
  );
}
function Issues() {
  const [params, setParams] = useSearchParams();
  const result = useLoad<Page<Issue>>("/issues?" + params.toString());
  const projects = useLoad<Project[]>("/projects");
  return (
    <>
      <Header
        eyebrow="ISSUE EXPLORER"
        title="Give every error a resolution."
        description="Group the noise. Investigate the exceptions that matter."
      >
        <button className="secondary" onClick={result.reload}>
          <RefreshCw size={15} />
          Refresh
        </button>
      </Header>
      <Filters params={params} setParams={setParams} projects={projects.data} />
      <p className="filter-note">
        Counts and first/last seen use matching occurrences. Dates are UTC;
        status is the current issue status.
      </p>
      <ErrorBox error={result.error || projects.error} />
      <section className="panel">
        <div className="panel-heading">
          <h2>
            Issues{" "}
            <span className="count-pill">{result.data?.total ?? "—"}</span>
          </h2>
          <span className="muted">Server-side filtering</span>
        </div>
        {result.loading ? (
          <p className="loading">Loading issues…</p>
        ) : result.data?.items.length ? (
          <IssueTable items={result.data.items} />
        ) : (
          <Empty title="No matching issues">
            Try another filter, or send an error from your application.
          </Empty>
        )}
        {result.data && (
          <Pager
            {...result.data}
            onChange={(page) => {
              const p = new URLSearchParams(params);
              p.set("page", String(page));
              setParams(p);
            }}
          />
        )}
      </section>
    </>
  );
}
function Projects() {
  const result = useLoad<Project[]>("/projects");
  const [show, setShow] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState<Project>();
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setBusy(true);
    setError("");
    try {
      const p = await api<Project>("/projects", "POST", {
        name: form.get("name"),
        origins: String(form.get("origins"))
          .split("\n")
          .map((s) => s.trim())
          .filter(Boolean),
      });
      setCreated(p);
      setShow(false);
      result.reload();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <Header
        eyebrow="YOUR APPLICATIONS"
        title="One radar. Every project."
        description="Keep each application's errors and configuration in one place."
      >
        <button onClick={() => setShow(!show)}>
          <Plus size={16} />
          {show ? "Close form" : "New project"}
        </button>
      </Header>
      <ErrorBox error={result.error || error} />
      {show && (
        <section className="panel form-panel">
          <h2>Create a project</h2>
          <form onSubmit={submit}>
            <label>
              Project name
              <input
                name="name"
                placeholder="e.g. storefront-web"
                required
                maxLength={80}
              />
            </label>
            <label>
              Allowed application origins
              <textarea
                name="origins"
                rows={3}
                defaultValue={window.location.origin}
                required
              />
            </label>
            <p className="muted">
              One exact origin per line, including protocol and port. No paths,
              wildcards, or trailing slashes.
            </p>
            <button disabled={busy}>
              {busy ? "Creating…" : "Create project"}
            </button>
          </form>
        </section>
      )}
      {created?.key && <Setup project={created} rawKey={created.key} />}
      <div className="project-grid">
        {result.loading ? (
          <p>Loading projects…</p>
        ) : (
          result.data?.map((p) => (
            <Link className="project-card" key={p.id} to={`/projects/${p.id}`}>
              <div className="project-card-top">
                <span className="project-icon">
                  <FolderGit2 size={23} />
                </span>
                <Settings size={18} />
              </div>
              <h2>{p.name}</h2>
              <p>{p.origins[0]}</p>
              <div className="project-card-stats">
                <span>
                  <strong>{number(p._count?.issues ?? 0)}</strong>issues
                </span>
                <span>
                  <strong>{number(p._count?.events ?? 0)}</strong>events
                </span>
                <ChevronRight size={18} />
              </div>
            </Link>
          ))
        )}
      </div>
      {!result.loading && !result.data?.length && (
        <Empty title="Your first project starts here">
          Create a project to get a public ingestion key and installation
          instructions.
        </Empty>
      )}
    </>
  );
}
function Setup({ project, rawKey }: { project: Project; rawKey?: string }) {
  const command = "npm install ./path/to/bugradar/packages/browser-sdk";
  const snippet = `import { BugRadar } from '@bugradar/browser-sdk';\n\nBugRadar.init({\n  endpoint: '${API}/ingest',\n  projectKey: '${rawKey ?? "YOUR_PUBLIC_INGESTION_KEY"}',\n  environment: 'production',\n  release: '1.0.0',\n});`;
  return (
    <section className="panel setup">
      <div className="panel-heading">
        <div>
          <h2>Connect {project.name}</h2>
          <p>Two small steps to your first event.</p>
        </div>
        <Code2 size={22} />
      </div>
      <div className="panel-body">
        <div className="notice">
          This browser key is public and can only send events. It cannot read
          your project data.{" "}
          {rawKey
            ? "Copy it now: the full key is revealed only at creation or rotation."
            : "Only a hash is stored. Use your saved key or rotate it below."}
        </div>
        {rawKey && (
          <div className="key-display">
            <code>{rawKey}</code>
            <CopyButton text={rawKey} />
          </div>
        )}
        <h3>1. Install the local SDK package</h3>
        <p className="muted">
          Build the monorepo first, then replace the path below. The package is
          not published to npm.
        </p>
        <div className="code-header">
          <span>Terminal</span>
          <CopyButton text={command} />
        </div>
        <pre>{command}</pre>
        <h3>2. Initialize once, before your application renders</h3>
        <div className="code-header">
          <span>JavaScript / TypeScript</span>
          <CopyButton text={snippet} />
        </div>
        <pre>{snippet}</pre>
        <p className="muted">
          Allow your application's exact origin in settings. Redaction is
          best-effort: never send passwords, tokens, or sensitive personal data.
          Origin checks cannot stop forged requests from non-browser clients.
        </p>
        <Link className="text-link" to="/demo">
          Test the SDK in the playground <ArrowRight size={15} />
        </Link>
      </div>
    </section>
  );
}
function ProjectSettings() {
  const { id } = useParams();
  const result = useLoad<Project>("/projects/" + id);
  const [rawKey, setRawKey] = useState<string>();
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmRotate, setConfirmRotate] = useState(false);
  const navigate = useNavigate();
  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await api("/projects/" + id, "PATCH", {
        name: f.get("name"),
        origins: String(f.get("origins"))
          .split("\n")
          .map((s) => s.trim())
          .filter(Boolean),
      });
      setNotice("Project settings saved.");
      result.reload();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  if (result.loading) return <p className="loading">Loading project…</p>;
  if (!result.data) return <ErrorBox error={result.error} />;
  const project = result.data;
  return (
    <>
      <Link className="back" to="/projects">
        <ArrowLeft size={15} />
        All projects
      </Link>
      <Header
        eyebrow="PROJECT SETTINGS"
        title={project.name}
        description="Control your ingestion origins and SDK connection."
      />
      <ErrorBox error={error} />
      {notice && (
        <div className="notice success" role="status">
          {notice}
        </div>
      )}
      <section className="panel form-panel">
        <h2>General configuration</h2>
        <form onSubmit={save}>
          <label>
            Project name
            <input
              name="name"
              defaultValue={project.name}
              required
              maxLength={80}
            />
          </label>
          <label>
            Allowed application origins
            <textarea
              name="origins"
              defaultValue={project.origins.join("\n")}
              rows={4}
              required
            />
          </label>
          <p className="muted">
            One exact HTTP(S) origin per line. Use a separate project for
            applications with different ownership.
          </p>
          <button disabled={busy}>{busy ? "Saving…" : "Save changes"}</button>
        </form>
      </section>
      <Setup project={project} rawKey={rawKey} />
      <section className="panel form-panel">
        <h2>Ingestion key</h2>
        <p className="muted">
          Current key starts with <code>{project.keyPrefix}…</code>. Rotation
          immediately invalidates the old key; update all SDK installations.
        </p>
        {confirmRotate ? (
          <div className="inline">
            <span>Invalidate the existing key?</span>
            <button
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                setError("");
                try {
                  const p = await api<Project>(
                    `/projects/${id}/rotate-key`,
                    "POST",
                  );
                  setRawKey(p.key);
                  setConfirmRotate(false);
                  setNotice("Key rotated. Copy the new key above.");
                  result.reload();
                } catch (e) {
                  setError((e as Error).message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              Rotate now
            </button>
            <button
              className="secondary"
              onClick={() => setConfirmRotate(false)}
            >
              Cancel
            </button>
          </div>
        ) : (
          <button className="secondary" onClick={() => setConfirmRotate(true)}>
            <RefreshCw size={15} />
            Rotate key
          </button>
        )}
      </section>
      <section className="panel form-panel danger-zone">
        <h2>Delete project</h2>
        <p>Deletes all issues, occurrences, and activity permanently.</p>
        {confirmDelete ? (
          <div className="inline">
            <button
              className="danger"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                setError("");
                try {
                  await api("/projects/" + id, "DELETE");
                  navigate("/projects");
                } catch (e) {
                  setError((e as Error).message);
                  setBusy(false);
                }
              }}
            >
              Permanently delete {project.name}
            </button>
            <button
              className="secondary"
              onClick={() => setConfirmDelete(false)}
            >
              Cancel
            </button>
          </div>
        ) : (
          <button className="danger" onClick={() => setConfirmDelete(true)}>
            Delete project
          </button>
        )}
      </section>
    </>
  );
}
function IssueDetail() {
  const { id } = useParams();
  const [params, setParams] = useSearchParams();
  const issue = useLoad<Issue>("/issues/" + id);
  const events = useLoad<Page<Occurrence>>(`/issues/${id}/events?${params}`);
  const [activityPage, setActivityPage] = useState(1);
  const activity = useLoad<
    Page<{
      id: string;
      from?: string;
      to: string;
      reason: string;
      createdAt: string;
    }>
  >(`/issues/${id}/activity?page=${activityPage}&limit=10`);
  const [selected, setSelected] = useState<string>();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const event =
    events.data?.items.find((e) => e.id === selected) ?? events.data?.items[0];
  if (issue.loading) return <p className="loading">Loading issue…</p>;
  if (!issue.data) return <ErrorBox error={issue.error} />;
  const i = issue.data;
  return (
    <>
      <Link className="back" to="/issues">
        <ArrowLeft size={15} />
        All issues
      </Link>
      <Header
        eyebrow={i.project?.name ?? "ISSUE DETAIL"}
        title={i.name}
        description={i.message}
      >
        <Badge status={i.status} />
        <select
          aria-label="Change issue status"
          value={i.status}
          disabled={busy}
          onChange={async (e) => {
            setBusy(true);
            setError("");
            try {
              await api(`/issues/${id}/status`, "PATCH", {
                status: e.target.value,
              });
              issue.reload();
              activity.reload();
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          {statuses.map((s) => (
            <option key={s} value={s}>
              {label(s)}
            </option>
          ))}
        </select>
        <button
          className="secondary"
          onClick={() => {
            issue.reload();
            events.reload();
            activity.reload();
          }}
        >
          <RefreshCw size={15} />
          Refresh
        </button>
      </Header>
      <ErrorBox error={error || events.error || activity.error} />
      <div className="issue-meta">
        <div>
          <small>Total occurrences · all time</small>
          <strong>{number(i.count)}</strong>
        </div>
        <div>
          <small>First seen · all time</small>
          <strong>{date(i.firstSeen)}</strong>
        </div>
        <div>
          <small>Last seen · all time</small>
          <strong>{date(i.lastSeen)}</strong>
        </div>
        {i.reopenedAt && (
          <div>
            <small>Last reopened</small>
            <strong>{date(i.reopenedAt)}</strong>
          </div>
        )}
      </div>
      <h2 className="section-title">Occurrence explorer</h2>
      <Filters params={params} setParams={setParams} withStatus={false} />
      <p className="filter-note">
        Matching occurrences: {events.data?.total ?? "—"} · First:{" "}
        {date(events.data?.firstSeen)} · Last: {date(events.data?.lastSeen)}.
        Date filters use UTC receipt time.
      </p>
      <div className="detail-grid">
        <section className="panel occurrence-list">
          <div className="panel-heading">
            <h2>Occurrences</h2>
          </div>
          {events.loading ? (
            <p className="loading">Loading…</p>
          ) : (
            events.data?.items.map((e) => (
              <button
                key={e.id}
                className={`occurrence ${event?.id === e.id ? "selected" : ""}`}
                onClick={() => setSelected(e.id)}
              >
                <strong>{date(e.receivedAt)}</strong>
                <span>
                  {e.environment} <i>·</i> {e.release || "No release"}
                </span>
              </button>
            ))
          )}
          {!events.loading && !events.data?.items.length && (
            <p className="loading">No matching occurrences.</p>
          )}
          {events.data && (
            <Pager
              {...events.data}
              onChange={(page) => {
                const p = new URLSearchParams(params);
                p.set("page", String(page));
                setParams(p);
              }}
            />
          )}
        </section>
        <section className="panel">
          <div className="panel-heading">
            <h2>Event context</h2>
            <span className="muted">{event?.environment}</span>
          </div>
          {event ? (
            <div className="panel-body">
              <h3>Stack trace</h3>
              <pre className="stack">
                {event.stack || "No stack trace available for this event."}
              </pre>
              <dl className="event-facts">
                <dt>Release</dt>
                <dd>{event.release || "Not provided"}</dd>
                <dt>Page URL</dt>
                <dd>{event.url || "Not provided"}</dd>
                <dt>Browser</dt>
                <dd>{event.userAgent || "Not provided"}</dd>
                <dt>SDK version</dt>
                <dd>{event.sdkVersion}</dd>
                <dt>Received at</dt>
                <dd>{date(event.receivedAt)}</dd>
                <dt>Client time (untrusted)</dt>
                <dd>{event.clientTimestamp || "Not provided"}</dd>
              </dl>
              <h3>
                Breadcrumbs{" "}
                <span className="count-pill">{event.breadcrumbs.length}</span>
              </h3>
              {event.breadcrumbs.length ? (
                event.breadcrumbs.map((b, n) => (
                  <div className="breadcrumb" key={n}>
                    <code>{b.category}</code>
                    <span>{b.message}</span>
                    <small>{b.timestamp}</small>
                  </div>
                ))
              ) : (
                <p className="muted">
                  No breadcrumbs were sent with this occurrence.
                </p>
              )}
            </div>
          ) : (
            <Empty title="Select an occurrence">
              Event details will appear here.
            </Empty>
          )}
        </section>
      </div>
      <section className="panel activity-panel">
        <div className="panel-heading">
          <h2>Issue activity</h2>
        </div>
        {activity.data?.items.map((a) => (
          <div className="activity-row" key={a.id}>
            <span className="activity-dot" />
            <div>
              <strong>{a.reason}</strong>
              <small>
                {a.from ? `${label(a.from)} → ` : ""}
                {label(a.to)}
              </small>
            </div>
            <time>{date(a.createdAt)}</time>
          </div>
        ))}
        {activity.data && (
          <Pager {...activity.data} onChange={setActivityPage} />
        )}
      </section>
    </>
  );
}
function Demo() {
  const [key, setKey] = useState("");
  const [connected, setConnected] = useState(false);
  const [notice, setNotice] = useState("");
  useEffect(() => () => BugRadar.destroy(), []);
  const repeated = () => {
    const e = new Error("Checkout failed: inventory unavailable");
    e.name = "CheckoutError";
    e.stack =
      "CheckoutError: Checkout failed: inventory unavailable\n    at submitOrder (https://demo.bugradar.test/checkout.js:42:12)";
    return e;
  };
  function trigger(kind: number) {
    BugRadar.addBreadcrumb({
      category: "demo",
      message: `Clicked demo action ${kind + 1}`,
    });
    if (kind === 0)
      BugRadar.captureException(
        new TypeError("Cannot read properties of undefined (reading cart)"),
      );
    if (kind === 1)
      setTimeout(() => {
        throw new Error("Demo uncaught browser error");
      }, 0);
    if (kind === 2)
      void Promise.reject({
        message: "Demo asynchronous checkout rejected",
        code: "PAYMENT_UNAVAILABLE",
      });
    if (kind === 3)
      for (let n = 0; n < 5; n++) BugRadar.captureException(repeated());
    setNotice(
      "Event queued by the SDK. Open Issues and refresh to confirm receipt. Delivery can fail if the key or allowed origin is incorrect.",
    );
  }
  return (
    <>
      <Header
        eyebrow="SDK PLAYGROUND"
        title="Meet your next caught exception."
        description="Send real events through the browser SDK and your ingestion API."
      />
      <div className="notice">
        Create a project with <code>{window.location.origin}</code> in its
        origin allowlist. Paste its public ingestion key below. This page sends
        real errors, including intentional console errors.
      </div>
      <section className="panel form-panel">
        <h2>Connect the demo</h2>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            BugRadar.init({
              endpoint: API + "/ingest",
              projectKey: key,
              environment: "development",
              release: "demo-1.0.0",
            });
            setConnected(true);
            setNotice("SDK initialized. Choose an action below.");
          }}
        >
          <label>
            Public ingestion key
            <input
              value={key}
              onChange={(e) => {
                setKey(e.target.value);
                setConnected(false);
                BugRadar.destroy();
              }}
              placeholder="br_…"
              pattern="br_[a-f0-9]{64}"
              required
            />
          </label>
          <div className="inline">
            <button>{connected ? "Reconnect SDK" : "Connect SDK"}</button>
            {connected && (
              <button
                type="button"
                className="secondary"
                onClick={() => {
                  BugRadar.destroy();
                  setConnected(false);
                  setNotice("SDK disconnected and listeners removed.");
                }}
              >
                Disconnect
              </button>
            )}
          </div>
        </form>
      </section>
      {notice && (
        <div className="notice success" role="status">
          {notice}
        </div>
      )}
      <div className="demo-grid">
        {[
          ["Captured exception", "Send a TypeError with captureException()."],
          [
            "Uncaught browser error",
            "Throw from a timer and let the window listener catch it.",
          ],
          [
            "Unhandled rejection",
            "Reject a promise with a structured non-Error value.",
          ],
          [
            "Repeated occurrences",
            "Send five distinct events with the same fingerprint.",
          ],
        ].map(([title, description], n) => (
          <section className="panel demo-card" key={title}>
            <span className="demo-number">0{n + 1}</span>
            <h2>{title}</h2>
            <p>{description}</p>
            <button
              className="secondary"
              disabled={!connected}
              onClick={() => trigger(n)}
            >
              <Zap size={15} />
              Trigger event{n === 3 ? "s" : ""}
            </button>
          </section>
        ))}
      </div>
      <Link to="/issues" className="button">
        View received issues
        <ArrowRight size={16} />
      </Link>
    </>
  );
}
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>,
);
