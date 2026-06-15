"use client";

import { useEffect, useMemo, useState } from "react";
import axios from "axios";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Database, Loader2, RefreshCw, ShieldCheck } from "lucide-react";

type ConnectionRow = {
  source_name: string;
  scope: "personal" | "inherited" | string;
  active_via: "tenant" | "shared" | null;
  status: string;
  last_verified_at: string | null;
};

export default function CoralConnectionsSettings() {
  const [connections, setConnections] = useState<ConnectionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [splunkHost, setSplunkHost] = useState("");
  const [splunkToken, setSplunkToken] = useState("");

  const loadConnections = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await axios.get("/api/coral/connections");
      setConnections(Array.isArray(res.data?.connections) ? res.data.connections : []);
    } catch (err: any) {
      setError(err.response?.data?.detail || err.response?.data?.error || err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadConnections();
  }, []);

  const splunkConnection = useMemo(
    () => connections.find((connection) => connection.source_name === "splunk") || null,
    [connections]
  );

  const handleConnectSplunk = async () => {
    setSaving(true);
    setError(null);
    setSuccess(null);

    try {
      await axios.post("/api/coral/connections", {
        source: "splunk",
        vars: {
          SPLUNK_HOST: splunkHost.trim(),
          SPLUNK_TOKEN: splunkToken.trim(),
        },
      });

      setSplunkToken("");
      setSuccess("Splunk connected for your account.");
      await loadConnections();
    } catch (err: any) {
      setError(err.response?.data?.detail || err.response?.data?.error || err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mx-auto max-w-4xl space-y-6 px-3 py-4 sm:px-5 sm:py-6 lg:px-8 lg:py-10">
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2 text-sm font-medium text-blue-700">
          <Database className="h-4 w-4" />
          Coral Integrations
        </div>
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-900">
          Per-user Coral Connections
        </h1>
        <p className="max-w-2xl text-sm leading-6 text-zinc-600">
          Connect your own Splunk while keeping the shared/demo Coral setup as a fallback for
          judges and new users.
        </p>
      </div>

      <Card className="border-zinc-200 shadow-sm">
        <CardHeader className="flex flex-row items-start justify-between gap-4">
          <div>
            <CardTitle className="flex items-center gap-2 text-lg">
              <ShieldCheck className="h-5 w-5 text-orange-500" />
              Splunk
            </CardTitle>
            <p className="mt-1 text-sm text-zinc-600">
              Provide your Splunk management URL and read token. Secrets are provisioned into your
              Coral config directory on the sidecar and are not stored in the app database.
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void loadConnections()}
            disabled={loading}
            className="gap-2"
          >
            {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
            Refresh
          </Button>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <Badge className="bg-orange-100 text-orange-800 hover:bg-orange-100 border-none">
              {splunkConnection?.scope === "personal" ? "Personal" : "Shared fallback"}
            </Badge>
            <Badge variant="outline" className="border-zinc-300 text-zinc-700">
              Status: {splunkConnection?.status ?? "not connected"}
            </Badge>
            {splunkConnection?.active_via && (
              <Badge variant="outline" className="border-zinc-300 text-zinc-700">
                Active via: {splunkConnection.active_via}
              </Badge>
            )}
            {splunkConnection?.last_verified_at && (
              <span className="text-xs text-zinc-500">
                Last verified: {new Date(splunkConnection.last_verified_at).toLocaleString()}
              </span>
            )}
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <label className="text-sm font-medium text-zinc-700">Splunk host</label>
              <Input
                value={splunkHost}
                onChange={(event) => setSplunkHost(event.target.value)}
                placeholder="https://your-splunk-host:8089"
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-zinc-700">Splunk token</label>
              <Input
                type="password"
                value={splunkToken}
                onChange={(event) => setSplunkToken(event.target.value)}
                placeholder="Paste a read-scoped token"
              />
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <Button
              onClick={() => void handleConnectSplunk()}
              disabled={saving || !splunkHost.trim() || !splunkToken.trim()}
              className="gap-2"
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
              Connect Splunk
            </Button>
            <span className="text-xs text-zinc-500">
              If you do nothing here, Coral will keep using the shared/demo Splunk connection.
            </span>
          </div>

          {success && (
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
              {success}
            </div>
          )}

          {error && (
            <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
              {error}
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="border-zinc-200 shadow-sm">
        <CardHeader>
          <CardTitle className="text-base">Resolved Coral sources</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {connections.length === 0 && !loading && (
            <p className="text-sm text-zinc-500">
              No Coral sources were reported yet. The shared/demo sidecar may still be starting.
            </p>
          )}

          <div className="space-y-2">
            {connections.map((connection) => (
              <div
                key={connection.source_name}
                className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-zinc-200 bg-white px-3 py-3"
              >
                <div>
                  <div className="text-sm font-medium text-zinc-900">{connection.source_name}</div>
                  <div className="text-xs text-zinc-500">
                    {connection.scope === "personal"
                      ? "Provisioned in your personal Coral config"
                      : "Inherited from the shared/demo Coral config"}
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge
                    className={
                      connection.scope === "personal"
                        ? "bg-blue-100 text-blue-800 hover:bg-blue-100 border-none"
                        : "bg-zinc-100 text-zinc-800 hover:bg-zinc-100 border-none"
                    }
                  >
                    {connection.scope}
                  </Badge>
                  <Badge variant="outline" className="border-zinc-300 text-zinc-700">
                    {connection.status}
                  </Badge>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
