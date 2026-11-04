"""Scout worker bridge to JobSpy (https://github.com/speedyapply/JobSpy, MIT).

Reads one JSON request on stdin, prints a JSON array of job records on stdout.
Errors are printed as {"error": "..."} with exit code 1. Never logs in anywhere:
JobSpy reads public listings only.
"""

import json
import sys


def main() -> int:
    try:
        req = json.load(sys.stdin)
    except Exception as exc:  # noqa: BLE001
        print(json.dumps({"error": f"bad request: {exc}"}))
        return 1
    try:
        from jobspy import scrape_jobs  # imported lazily so a bad install gives a clear error

        df = scrape_jobs(
            site_name=[req["site"]],
            search_term=req.get("search_term"),
            location=req.get("location") or None,
            is_remote=bool(req.get("is_remote", False)),
            results_wanted=int(req.get("results_wanted", 25)),
            hours_old=req.get("hours_old"),
            country_indeed=req.get("country_indeed") or "india",
            description_format="markdown",
            linkedin_fetch_description=False,
            verbose=0,
        )
        records = json.loads(df.to_json(orient="records", date_format="iso")) if len(df) else []
        print(json.dumps(records))
        return 0
    except Exception as exc:  # noqa: BLE001
        print(json.dumps({"error": f"{type(exc).__name__}: {exc}"[:500]}))
        return 1


if __name__ == "__main__":
    sys.exit(main())
