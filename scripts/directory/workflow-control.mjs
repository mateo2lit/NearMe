// Operator helper for machines without gh. Credentials remain in memory only.
// Dispatch is deliberately restricted to the Phase 2 DRY RUN on main.
import { execFileSync } from "node:child_process";
import { writeFile } from "node:fs/promises";
const repo = "mateo2lit/NearMe";
async function main() {
  let token = process.env.GH_TOKEN;
  if (!token) {
    const credential = execFileSync("git", ["credential", "fill"], {
      input: "protocol=https\nhost=github.com\n\n",
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
    });
    token = credential.split("\n").find((line) => line.startsWith("password="))
      ?.slice(9);
  }
  if (!token) throw new Error("missing_github_credential");
  const api = async (path, init = {}) => {
    const r = await fetch(`https://api.github.com/repos/${repo}/${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        ...init.headers,
      },
      signal: AbortSignal.timeout(30000),
    });
    if (!r.ok) throw new Error(`github_http_${r.status}`);
    return r;
  };
  const [command, id, output] = process.argv.slice(2);
  if (command === "dispatch") {
    const max = Number(id || 100);
    if (!Number.isSafeInteger(max) || max < 1 || max > 50000) {
      throw new Error("invalid_max_sites");
    }
    const inputs = {
      tile: "t24_85",
      dry_run: "true",
      bootstrap: "true",
      max_sites: String(max),
    };
    if (output) {
      if (!/^\d+$/.test(output)) throw new Error("invalid_review_run");
      inputs.review_run = output;
    }
    await api("actions/workflows/source-directory-feeds.yml/dispatches", {
      method: "POST",
      body: JSON.stringify({ ref: "main", inputs }),
    });
    console.log(
      JSON.stringify({ dispatched: true, dry_run: true, max_sites: max }),
    );
  } else if (command === "runs") {
    const result = await (await api(
      "actions/workflows/source-directory-feeds.yml/runs?per_page=5",
    )).json();
    console.log(
      JSON.stringify(
        result.workflow_runs.map((r) => ({
          id: r.id,
          status: r.status,
          conclusion: r.conclusion,
          url: r.html_url,
          sha: r.head_sha,
        })),
      ),
    );
  } else if (command === "jobs" && /^\d+$/.test(id)) {
    const result = await (await api(`actions/runs/${id}/jobs?per_page=100`))
      .json();
    console.log(
      JSON.stringify(
        result.jobs.map((j) => ({
          id: j.id,
          name: j.name,
          status: j.status,
          conclusion: j.conclusion,
          steps: j.steps.map((s) => ({
            name: s.name,
            status: s.status,
            conclusion: s.conclusion,
          })),
        })),
      ),
    );
  } else if (command === "artifacts" && /^\d+$/.test(id)) {
    const result = await (await api(`actions/runs/${id}/artifacts`)).json();
    console.log(
      JSON.stringify(
        result.artifacts.map((a) => ({
          id: a.id,
          name: a.name,
          bytes: a.size_in_bytes,
        })),
      ),
    );
  } else if (
    (command === "download" || command === "logs") && /^\d+$/.test(id) && output
  ) {
    const result = await api(
      command === "download"
        ? `actions/artifacts/${id}/zip`
        : `actions/jobs/${id}/logs`,
    );
    await writeFile(output, new Uint8Array(await result.arrayBuffer()));
    console.log(JSON.stringify({ saved: output }));
  } else throw new Error("invalid_command");
}
main().catch((e) => {
  console.error(
    /^[a-z0-9_]+$/.test(e.message) ? e.message : "workflow_control_failed",
  );
  process.exitCode = 1;
});
