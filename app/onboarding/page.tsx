"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import AuthShell from "@/components/auth-shell";

const ORG_TYPES = ["School", "Church", "Association", "Club", "Other"];

function makeSlug(name: string) {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return `${base || "org"}-${Math.random().toString(36).slice(2, 6)}`;
}

export default function OnboardingPage() {
  const router = useRouter();
  const supabase = createClient();

  const [name, setName] = useState("");
  const [orgType, setOrgType] = useState(ORG_TYPES[0]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const { error } = await supabase.rpc("create_organization", {
      _name: name.trim(),
      _slug: makeSlug(name),
      _type: orgType,
    });

    if (error) {
      setError(error.message);
      setLoading(false);
    } else {
      router.push("/dashboard");
    }
  }

  async function logOut() {
    await supabase.auth.signOut();
    router.push("/login");
  }

  return (
    <AuthShell
      title="Set up your organization"
      subtitle="This is the workspace your admins and treasurers will share. You'll be its first admin."
      footer={
        <>
          Wrong account?{" "}
          <button type="button" className="link-quiet" onClick={logOut}>
            Log out
          </button>
        </>
      }
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="label" htmlFor="orgName">
            Organization name
          </label>
          <input
            id="orgName"
            className="field"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
          />
        </div>

        <div>
          <label className="label" htmlFor="orgType">
            Type of organization
          </label>
          <select
            id="orgType"
            className="field"
            value={orgType}
            onChange={(e) => setOrgType(e.target.value)}
          >
            {ORG_TYPES.map((t) => (
              <option key={t}>{t}</option>
            ))}
          </select>
        </div>

        {error && (
          <p className="msg-error" role="alert">
            {error}
          </p>
        )}

        <button type="submit" disabled={loading} className="btn-primary">
          {loading ? "Creating..." : "Create organization"}
        </button>
      </form>
    </AuthShell>
  );
}
