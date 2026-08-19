import { useState, useMemo, useCallback, useEffect } from "react";
import { Link } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { DiscordStatus, AvailableDiscordChannel } from "@/lib/types";
import { 
  ArrowLeft, Activity, Radio, AlertTriangle, CheckCircle2, 
  Settings2, Loader2, Save, XCircle, Clock
} from "lucide-react";
import { SiDiscord } from "react-icons/si";

export default function DiscordPage() {
  const { data: discord, isLoading, error } = useQuery<DiscordStatus>({
    queryKey: ["/api/discord"],
    refetchInterval: 15_000,
  });

  const [selectedChannelIds, setSelectedChannelIds] = useState<Set<string>>(new Set());
  const [hasInitializedSelection, setHasInitializedSelection] = useState(false);

  useEffect(() => {
    if (!discord || hasInitializedSelection) return;
    setSelectedChannelIds(new Set(discord.selectedChannels.map(c => c.channelId)));
    setHasInitializedSelection(true);
  }, [discord, hasInitializedSelection]);

  const saveChannelsMutation = useMutation({
    mutationFn: async (channels: AvailableDiscordChannel[]) => {
      const response = await apiRequest("PUT", "/api/discord/channels", {
        channels: channels.map(c => ({
          guildId: c.guildId,
          guildName: c.guildName,
          channelId: c.channelId,
          channelName: c.channelName,
        })),
      });
      return (await response.json()) as DiscordStatus;
    },
    onSuccess: (next) => {
      queryClient.setQueryData(["/api/discord"], next);
      setSelectedChannelIds(new Set(next.selectedChannels.map(c => c.channelId)));
    },
  });

  const handleToggleChannel = useCallback((channelId: string) => {
    setSelectedChannelIds(prev => {
      const next = new Set(prev);
      if (next.has(channelId)) {
        next.delete(channelId);
      } else {
        next.add(channelId);
      }
      return next;
    });
  }, []);

  const handleSaveChannels = useCallback(() => {
    if (!discord) return;
    const channelsToSave = discord.availableChannels.filter(c => selectedChannelIds.has(c.channelId));
    saveChannelsMutation.mutate(channelsToSave);
  }, [discord, selectedChannelIds, saveChannelsMutation]);

  const hasUnsavedChanges = useMemo(() => {
    if (!discord) return false;
    const initialSelection = new Set(discord.selectedChannels.map(c => c.channelId));
    if (initialSelection.size !== selectedChannelIds.size) return true;
    for (const id of selectedChannelIds) {
      if (!initialSelection.has(id)) return true;
    }
    return false;
  }, [discord, selectedChannelIds]);

  const channelsByGuild = useMemo(() => {
    if (!discord) return {};
    const grouped: Record<string, AvailableDiscordChannel[]> = {};
    for (const ch of discord.availableChannels) {
      if (!grouped[ch.guildName]) grouped[ch.guildName] = [];
      grouped[ch.guildName].push(ch);
    }
    return grouped;
  }, [discord]);

  return (
    <div className="min-h-full flex flex-col bg-gradient-to-b from-black via-[#0d0a06] to-black text-white/90">
      <header className="flex items-center justify-between px-6 py-4 border-b border-gold/20 bg-black/60 sticky top-0 z-10">
        <div className="flex items-center gap-4">
          <Link
            href="/"
            className="p-2 rounded-lg text-white/50 hover:text-gold hover:bg-white/5 transition-colors"
            data-testid="link-home"
            title="Home"
          >
            <ArrowLeft className="w-5 h-5" />
          </Link>
          <div className="p-2 bg-gold/10 rounded-lg">
            <SiDiscord className="w-6 h-6 text-gold" />
          </div>
          <div>
            <h1 className="font-serif text-2xl text-gold leading-tight" data-testid="text-title">
              Discord Court Herald
            </h1>
            <div className="flex items-center gap-2">
              <span className="text-xs text-white/50" data-testid="text-subtitle">
                A public doorway from the private sanctuary
              </span>
            </div>
          </div>
        </div>
      </header>

      <main className="flex-1 overflow-y-auto p-6 space-y-8 max-w-5xl mx-auto w-full">
        {isLoading && (
          <div className="flex items-center justify-center py-20 text-gold/60 gap-3">
            <Loader2 className="w-6 h-6 animate-spin" />
            <span className="font-serif text-lg italic">Divining connection state...</span>
          </div>
        )}

        {error && (
          <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-6 text-red-400">
            <div className="flex items-center gap-3 font-semibold mb-2">
              <AlertTriangle className="w-5 h-5" />
              Failed to load Discord status
            </div>
            <p className="text-sm opacity-80">{error instanceof Error ? error.message : "Unknown error"}</p>
          </div>
        )}

        {discord && (
          <>
            {/* CONNECTION HEALTH */}
            <section className="bg-white/5 border border-white/10 rounded-2xl overflow-hidden">
              <div className="p-5 border-b border-white/10 flex items-center gap-3 bg-black/40">
                <Activity className="w-5 h-5 text-gold/70" />
                <h2 className="font-serif text-xl text-gold">Connection Health</h2>
              </div>
              <div className="p-6 grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                  <h3 className="text-sm uppercase tracking-wider text-white/40 mb-2">Status</h3>
                  <div className="flex items-center gap-3">
                    {discord.connectionState === "connected" && <CheckCircle2 className="w-5 h-5 text-green-500" data-testid="icon-status-connected" />}
                    {discord.connectionState === "connecting" && <Loader2 className="w-5 h-5 text-amber-500 animate-spin" data-testid="icon-status-connecting" />}
                    {discord.connectionState === "error" && <XCircle className="w-5 h-5 text-red-500" data-testid="icon-status-error" />}
                    {discord.connectionState === "not_configured" && <Settings2 className="w-5 h-5 text-slate-400" data-testid="icon-status-not_configured" />}
                    <span className="text-lg font-medium capitalize" data-testid="text-connection-state">
                      {discord.connectionState.replace("_", " ")}
                    </span>
                  </div>
                  {discord.connectionError && (
                    <p className="mt-2 text-sm text-red-400 bg-red-500/10 p-3 rounded-lg border border-red-500/20" data-testid="text-connection-error">
                      {discord.connectionError}
                    </p>
                  )}
                  {discord.botUser && (
                    <p className="mt-2 text-sm text-white/60" data-testid="text-bot-user">
                      Operating as: <strong className="text-white/90">{discord.botUser}</strong>
                    </p>
                  )}
                  {discord.connectedAt && (
                    <p className="mt-1 text-xs text-white/40" data-testid="text-connected-at">
                      Since {new Date(discord.connectedAt).toLocaleString()}
                    </p>
                  )}
                </div>

                <div className="space-y-4">
                  <div>
                    <h3 className="text-sm uppercase tracking-wider text-white/40 mb-2">Requirements</h3>
                    <ul className="text-sm text-white/70 space-y-1">
                      {discord.requiredIntent && (
                        <li className="flex items-center gap-2" data-testid={`text-intent-${discord.requiredIntent}`}>
                          <span className="w-1.5 h-1.5 rounded-full bg-gold/50" />
                          Intent: {discord.requiredIntent}
                        </li>
                      )}
                      {discord.requiredPermissions.map(perm => (
                        <li key={perm} className="flex items-center gap-2" data-testid={`text-perm-${perm}`}>
                          <span className="w-1.5 h-1.5 rounded-full bg-gold/50" />
                          Permission: {perm}
                        </li>
                      ))}
                      {(!discord.requiredIntent && discord.requiredPermissions.length === 0) && (
                        <li className="text-white/40 italic">No specific permissions required</li>
                      )}
                    </ul>
                  </div>

                  {discord.inviteUrl && (
                    <a
                      href={discord.inviteUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-2 px-4 py-2 bg-gold/15 hover:bg-gold/25 text-gold rounded-xl border border-gold/30 transition-colors text-sm font-medium"
                      data-testid="link-invite"
                    >
                      <SiDiscord className="w-4 h-4" />
                      Invite Bot to Server
                    </a>
                  )}
                </div>
              </div>
            </section>

            {/* CHANNEL OPT-INS */}
            <section className="bg-white/5 border border-white/10 rounded-2xl overflow-hidden">
              <div className="p-5 border-b border-white/10 flex items-center justify-between bg-black/40">
                <div className="flex items-center gap-3">
                  <Radio className="w-5 h-5 text-gold/70" />
                  <h2 className="font-serif text-xl text-gold">Channel Audience</h2>
                </div>
                <button
                  onClick={handleSaveChannels}
                  disabled={!hasUnsavedChanges || saveChannelsMutation.isPending}
                  className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors border ${
                    hasUnsavedChanges
                      ? "bg-ember/20 text-ember-300 border-ember/40 hover:bg-ember/30"
                      : "bg-white/5 text-white/30 border-white/10 cursor-not-allowed"
                  }`}
                  data-testid="button-save-channels"
                >
                  {saveChannelsMutation.isPending ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : saveChannelsMutation.isSuccess && !hasUnsavedChanges ? (
                    <CheckCircle2 className="w-4 h-4" />
                  ) : (
                    <Save className="w-4 h-4" />
                  )}
                  {saveChannelsMutation.isPending ? "Saving..." : saveChannelsMutation.isSuccess && !hasUnsavedChanges ? "Saved" : "Save Preferences"}
                </button>
              </div>

              <div className="p-6">
                {saveChannelsMutation.isError && (
                  <div
                    className="mb-4 rounded-xl border border-red-500/25 bg-red-500/10 px-4 py-3 text-sm text-red-300"
                    data-testid="text-channel-save-error"
                  >
                    {saveChannelsMutation.error instanceof Error
                      ? saveChannelsMutation.error.message
                      : "The selected halls could not be saved."}
                  </div>
                )}
                {saveChannelsMutation.isSuccess && !hasUnsavedChanges && (
                  <div
                    className="mb-4 rounded-xl border border-emerald-500/25 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-300"
                    data-testid="text-channel-save-success"
                  >
                    The permitted halls are saved. Ash will observe only these checked channels.
                  </div>
                )}
                {Object.keys(channelsByGuild).length === 0 ? (
                  <p className="text-white/40 italic font-serif" data-testid="text-no-channels">
                    The Herald sees no accessible channels. Invite the bot and ensure it has permissions.
                  </p>
                ) : (
                  <div className="space-y-6">
                    <p className="text-sm text-white/50" data-testid="text-channel-instruction">
                      Select which public domains Ash may observe and address. The Herald will only read from and reply to checked channels.
                    </p>
                    {Object.entries(channelsByGuild).map(([guildName, channels]) => (
                      <div key={guildName} className="space-y-3" data-testid={`group-guild-${guildName}`}>
                        <h3 className="font-serif text-lg text-white/80 border-b border-white/5 pb-2">
                          {guildName}
                        </h3>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                          {channels.map((ch) => {
                            const isSelectable = ch.canRead && ch.canReply;
                            const isSelected = selectedChannelIds.has(ch.channelId);

                            return (
                              <label
                                key={ch.channelId}
                                className={`flex items-start gap-3 p-3 rounded-xl border transition-colors ${
                                  isSelectable 
                                    ? isSelected ? "bg-gold/10 border-gold/30 cursor-pointer" : "bg-white/5 border-white/10 hover:bg-white/10 hover:border-white/20 cursor-pointer"
                                    : "bg-black/40 border-red-500/20 opacity-60 cursor-not-allowed"
                                }`}
                                data-testid={`label-channel-${ch.channelId}`}
                              >
                                <div className="pt-0.5">
                                  <input
                                    type="checkbox"
                                    checked={isSelected}
                                    disabled={!isSelectable}
                                    onChange={() => handleToggleChannel(ch.channelId)}
                                    className="w-4 h-4 rounded border-white/20 text-gold focus:ring-gold/50 bg-black/50"
                                    data-testid={`checkbox-channel-${ch.channelId}`}
                                  />
                                </div>
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center justify-between gap-2">
                                    <span className={`text-sm font-medium truncate ${isSelected ? "text-gold-light" : "text-white/80"}`}>
                                      #{ch.channelName}
                                    </span>
                                  </div>
                                  {!isSelectable && ch.permissionError && (
                                    <p className="text-xs text-red-400 mt-1 flex items-center gap-1" data-testid={`text-perm-error-${ch.channelId}`}>
                                      <AlertTriangle className="w-3 h-3" />
                                      {ch.permissionError}
                                    </p>
                                  )}
                                </div>
                              </label>
                            );
                          })}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </section>

            {/* RECENT ACTIVITY */}
            <section className="bg-white/5 border border-white/10 rounded-2xl overflow-hidden">
              <div className="p-5 border-b border-white/10 flex items-center gap-3 bg-black/40">
                <Clock className="w-5 h-5 text-gold/70" />
                <h2 className="font-serif text-xl text-gold">Court Activity</h2>
              </div>
              
              <div className="divide-y divide-white/5">
                {discord.activity.length === 0 ? (
                  <div className="p-6 text-center text-white/40 italic font-serif" data-testid="text-no-activity">
                    The Herald's records are empty.
                  </div>
                ) : (
                  discord.activity.map(act => (
                    <div key={act.id} className="p-5 hover:bg-white/[0.02] transition-colors" data-testid={`activity-row-${act.id}`}>
                      <div className="flex items-start justify-between gap-4 mb-2">
                        <div className="flex items-center gap-2">
                          <span className={`text-xs font-semibold uppercase tracking-wider px-2 py-0.5 rounded ${
                            act.kind === "receive" ? "bg-blue-500/20 text-blue-300" :
                            act.kind === "send" ? "bg-green-500/20 text-green-300" :
                            "bg-white/10 text-white/60"
                          }`} data-testid={`text-activity-kind-${act.id}`}>
                            {act.kind}
                          </span>
                          <span className="text-sm font-medium text-white/80" data-testid={`text-activity-author-${act.id}`}>
                            {act.authorName}
                          </span>
                          <span className="text-xs text-white/40">in #{act.channelName}</span>
                        </div>
                        <span className="text-xs text-white/30" data-testid={`text-activity-time-${act.id}`}>
                          {new Date(act.createdAt).toLocaleString()}
                        </span>
                      </div>
                      
                      <p className="text-sm text-white/70 bg-black/40 p-3 rounded-lg border border-white/5 whitespace-pre-wrap" data-testid={`text-activity-content-${act.id}`}>
                        {act.content}
                      </p>

                      {(act.deliveryStatus !== "context" || act.deliveryError) && (
                        <div className="mt-2 flex items-center gap-2 text-xs">
                          {act.deliveryStatus && (
                            <span className={`capitalize ${
                               act.deliveryStatus === "replied" ? "text-green-400" :
                               act.deliveryStatus === "queued" || act.deliveryStatus === "processing" || act.deliveryStatus === "sending"
                                 ? "text-amber-400" :
                               act.deliveryStatus === "failed" ? "text-red-400" : "text-white/45"
                            }`} data-testid={`text-activity-status-${act.id}`}>
                              {act.deliveryStatus}
                            </span>
                          )}
                          {act.deliveryError && (
                            <span className="text-red-400 flex items-center gap-1" data-testid={`text-activity-error-${act.id}`}>
                              <AlertTriangle className="w-3 h-3" />
                              {act.deliveryError}
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                  ))
                )}
              </div>
            </section>
          </>
        )}
      </main>
    </div>
  );
}
