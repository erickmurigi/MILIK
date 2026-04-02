import React, { useEffect, useMemo, useState } from 'react';
import { FaEnvelope, FaPaperPlane, FaSms, FaSyncAlt, FaTimes } from 'react-icons/fa';
import { toast } from 'react-toastify';
import {
  getCommunicationTemplates,
  previewCommunicationMessage,
  sendCommunicationMessage,
} from '../../redux/apiCalls';

const channelMeta = {
  sms: {
    label: 'SMS',
    icon: FaSms,
    pillClass: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  },
  email: {
    label: 'Email',
    icon: FaEnvelope,
    pillClass: 'bg-orange-50 text-orange-700 border-orange-200',
  },
};

const emptyTemplates = {
  sms: { templates: [], profileStatus: null },
  email: { templates: [], profileStatus: null },
};

const CommunicationComposerModal = ({
  open,
  onClose,
  businessId,
  contextType,
  recordIds = [],
  title = 'Send communication',
  subtitle = '',
  allowedChannels = ['sms', 'email'],
  defaultChannel = 'sms',
  onSent,
}) => {
  const normalizedRecordIds = useMemo(
    () => Array.from(new Set((Array.isArray(recordIds) ? recordIds : []).map((item) => String(item || '').trim()).filter(Boolean))),
    [recordIds]
  );
  const [loadingTemplates, setLoadingTemplates] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [channels, setChannels] = useState(emptyTemplates);
  const [activeChannel, setActiveChannel] = useState(defaultChannel);
  const [selectedTemplateKey, setSelectedTemplateKey] = useState('');
  const [preview, setPreview] = useState(null);

  useEffect(() => {
    if (!open) return;
    setActiveChannel(defaultChannel);
    setSelectedTemplateKey('');
    setPreview(null);
  }, [open, defaultChannel]);

  useEffect(() => {
    if (!open || !businessId || !contextType) return;

    let mounted = true;
    const load = async () => {
      try {
        setLoadingTemplates(true);
        const res = await getCommunicationTemplates({ business: businessId, contextType });
        if (!mounted) return;
        setChannels(res?.channels || emptyTemplates);

        const allowed = allowedChannels.filter((channel) => (res?.channels?.[channel]?.templates || []).length > 0 || channel === 'email' || channel === 'sms');
        const preferred = allowed.includes(defaultChannel) ? defaultChannel : allowed[0] || defaultChannel;
        setActiveChannel(preferred);
      } catch (error) {
        if (!mounted) return;
        toast.error(error?.response?.data?.message || error?.message || 'Failed to load communication templates.');
      } finally {
        if (mounted) setLoadingTemplates(false);
      }
    };

    load();
    return () => {
      mounted = false;
    };
  }, [open, businessId, contextType, allowedChannels, defaultChannel]);

  const channelOptions = useMemo(
    () => allowedChannels.filter((channel) => ['sms', 'email'].includes(channel)),
    [allowedChannels]
  );

  const templatesForChannel = useMemo(() => channels?.[activeChannel]?.templates || [], [channels, activeChannel]);
  const profileStatus = channels?.[activeChannel]?.profileStatus || null;

  useEffect(() => {
    if (!templatesForChannel.length) {
      setSelectedTemplateKey('');
      setPreview(null);
      return;
    }

    const stillExists = templatesForChannel.some((item) => item.key === selectedTemplateKey);
    if (!stillExists) {
      setSelectedTemplateKey(templatesForChannel[0].key);
      setPreview(null);
    }
  }, [templatesForChannel, selectedTemplateKey]);

  const handlePreview = async () => {
    if (!businessId || !contextType || !activeChannel || !selectedTemplateKey) {
      toast.warning('Choose a template first.');
      return;
    }
    if (!normalizedRecordIds.length) {
      toast.warning('Select at least one record before sending communication.');
      return;
    }

    try {
      setPreviewLoading(true);
      const res = await previewCommunicationMessage({
        business: businessId,
        contextType,
        channel: activeChannel,
        templateKey: selectedTemplateKey,
        recordIds: normalizedRecordIds,
      });
      setPreview(res);
    } catch (error) {
      setPreview(null);
      toast.error(error?.response?.data?.message || error?.message || 'Failed to preview communication.');
    } finally {
      setPreviewLoading(false);
    }
  };

  useEffect(() => {
    if (!open || !selectedTemplateKey) return;
    handlePreview();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, selectedTemplateKey, activeChannel]);

  const handleSend = async () => {
    if (!selectedTemplateKey) {
      toast.warning('Choose a template first.');
      return;
    }

    try {
      setSending(true);
      const res = await sendCommunicationMessage({
        business: businessId,
        contextType,
        channel: activeChannel,
        templateKey: selectedTemplateKey,
        recordIds: normalizedRecordIds,
      });
      setPreview(res);
      const sentCount = Number(res?.summary?.sentCount || 0);
      const failedCount = Number(res?.summary?.failedCount || 0);
      if (sentCount > 0 && failedCount === 0) {
        toast.success(`${channelMeta[activeChannel]?.label || 'Communication'} sent successfully.`);
      } else if (sentCount > 0 && failedCount > 0) {
        toast.warn(`${sentCount} sent, ${failedCount} failed.`);
      } else {
        toast.error(`No ${channelMeta[activeChannel]?.label?.toLowerCase() || 'communication'} was sent.`);
      }
      if (typeof onSent === 'function') {
        onSent(res);
      }
    } catch (error) {
      toast.error(error?.response?.data?.message || error?.message || 'Failed to send communication.');
    } finally {
      setSending(false);
    }
  };

  if (!open) return null;

  const sendableCount = Number(preview?.summary?.sendableCount || 0);
  const blockedCount = Number(preview?.summary?.blockedCount || 0);

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/40 p-4">
      <div className="flex max-h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded-[28px] border border-slate-200 bg-white shadow-2xl">
        <div className="flex items-start justify-between border-b border-slate-200 bg-gradient-to-r from-emerald-950 to-[#0B3B2E] px-6 py-5 text-white">
          <div>
            <h3 className="text-lg font-bold">{title}</h3>
            <p className="mt-1 text-sm text-emerald-100">{subtitle || 'Preview the final rendered message before sending.'}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full bg-white/10 p-2 text-white transition hover:bg-white/20"
            disabled={sending}
          >
            <FaTimes />
          </button>
        </div>

        <div className="grid min-h-0 flex-1 grid-cols-1 gap-0 lg:grid-cols-[360px_minmax(0,1fr)]">
          <div className="border-b border-slate-200 bg-slate-50 p-5 lg:border-b-0 lg:border-r">
            <div className="space-y-5">
              <div className="rounded-2xl border border-slate-200 bg-white p-4">
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Recipients</p>
                <p className="mt-2 text-2xl font-bold text-slate-900">{normalizedRecordIds.length}</p>
                <p className="mt-1 text-sm text-slate-500">Selected record{normalizedRecordIds.length === 1 ? '' : 's'} in this page context.</p>
              </div>

              <div>
                <label className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Channel</label>
                <div className="grid grid-cols-2 gap-2">
                  {channelOptions.map((channel) => {
                    const meta = channelMeta[channel];
                    const Icon = meta?.icon || FaPaperPlane;
                    const isActive = activeChannel === channel;
                    const hasTemplates = (channels?.[channel]?.templates || []).length > 0;
                    return (
                      <button
                        key={channel}
                        type="button"
                        disabled={!hasTemplates}
                        onClick={() => setActiveChannel(channel)}
                        className={`flex items-center justify-center gap-2 rounded-2xl border px-3 py-3 text-sm font-semibold transition ${
                          isActive
                            ? 'border-[#0B3B2E] bg-[#0B3B2E] text-white shadow-sm'
                            : hasTemplates
                            ? 'border-slate-300 bg-white text-slate-700 hover:border-slate-400'
                            : 'cursor-not-allowed border-slate-200 bg-slate-100 text-slate-400'
                        }`}
                      >
                        <Icon />
                        {meta?.label || channel}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div>
                <label className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Template</label>
                <select
                  value={selectedTemplateKey}
                  onChange={(event) => setSelectedTemplateKey(event.target.value)}
                  className="w-full rounded-2xl border border-slate-300 bg-white px-3 py-3 text-sm text-slate-800 outline-none transition focus:border-orange-400 focus:ring-2 focus:ring-orange-100"
                  disabled={loadingTemplates || !templatesForChannel.length}
                >
                  {!templatesForChannel.length ? <option value="">No templates available</option> : null}
                  {templatesForChannel.map((template) => (
                    <option key={template.key} value={template.key}>
                      {template.name}
                    </option>
                  ))}
                </select>
                {templatesForChannel.find((item) => item.key === selectedTemplateKey)?.description ? (
                  <p className="mt-2 text-xs text-slate-500">{templatesForChannel.find((item) => item.key === selectedTemplateKey)?.description}</p>
                ) : null}
              </div>

              <div className="rounded-2xl border border-slate-200 bg-white p-4 text-sm text-slate-700">
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Sender profile</p>
                {profileStatus ? (
                  <>
                    <div className="mt-3 flex items-center gap-2">
                      <span className={`inline-flex rounded-full border px-2.5 py-1 text-[11px] font-semibold ${channelMeta[activeChannel]?.pillClass || 'bg-slate-100 text-slate-700 border-slate-200'}`}>
                        {channelMeta[activeChannel]?.label}
                      </span>
                      <span className="text-sm font-semibold text-slate-900">{profileStatus.label || 'Profile status'}</span>
                    </div>
                    {profileStatus.reason ? <p className="mt-2 text-xs text-slate-500">{profileStatus.reason}</p> : null}
                  </>
                ) : (
                  <p className="mt-3 text-xs text-slate-500">No default {activeChannel} profile is configured for this company yet.</p>
                )}
              </div>

              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={handlePreview}
                  disabled={previewLoading || loadingTemplates || !selectedTemplateKey}
                  className="inline-flex flex-1 items-center justify-center gap-2 rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <FaSyncAlt className={previewLoading ? 'animate-spin' : ''} />
                  Refresh Preview
                </button>
                <button
                  type="button"
                  onClick={handleSend}
                  disabled={sending || previewLoading || !preview || sendableCount === 0}
                  className="inline-flex flex-1 items-center justify-center gap-2 rounded-2xl bg-[#0B3B2E] px-4 py-3 text-sm font-semibold text-white transition hover:bg-[#0A3127] disabled:cursor-not-allowed disabled:bg-slate-400"
                >
                  <FaPaperPlane />
                  Send Now
                </button>
              </div>
            </div>
          </div>

          <div className="min-h-0 p-5">
            <div className="mb-4 flex flex-wrap items-center gap-3">
              <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm font-semibold text-emerald-800">
                Sendable: {sendableCount}
              </div>
              <div className="rounded-2xl border border-orange-200 bg-orange-50 px-4 py-2 text-sm font-semibold text-orange-800">
                Blocked: {blockedCount}
              </div>
              {preview?.summary?.sentCount !== undefined ? (
                <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-2 text-sm font-semibold text-slate-700">
                  Sent: {preview?.summary?.sentCount || 0} · Failed: {preview?.summary?.failedCount || 0}
                </div>
              ) : null}
            </div>

            <div className="flex h-full min-h-[320px] flex-col overflow-hidden rounded-[26px] border border-slate-200 bg-slate-50">
              <div className="border-b border-slate-200 bg-white px-5 py-4">
                <h4 className="text-sm font-bold uppercase tracking-[0.18em] text-slate-500">Rendered preview</h4>
                <p className="mt-1 text-sm text-slate-500">Every row below shows the final resolved message for that recipient.</p>
              </div>

              <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
                {!preview && !previewLoading ? (
                  <div className="rounded-2xl border border-dashed border-slate-300 bg-white px-5 py-10 text-center text-sm text-slate-500">
                    Select a template to load the final rendered message preview.
                  </div>
                ) : null}

                {previewLoading ? (
                  <div className="rounded-2xl border border-slate-200 bg-white px-5 py-10 text-center text-sm text-slate-500">
                    Preparing preview…
                  </div>
                ) : null}

                {(preview?.previews || []).map((item) => (
                  <div key={item.recordId} className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
                    <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-bold text-slate-900">{item.recipientName || 'Recipient'}</p>
                        <p className="text-xs text-slate-500">{item.recipientPhone || item.recipientEmail || 'No recipient address available'}</p>
                      </div>
                      <span className={`inline-flex rounded-full border px-2.5 py-1 text-[11px] font-semibold ${item.canSend ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-red-200 bg-red-50 text-red-700'}`}>
                        {item.canSend ? 'Ready to send' : item.reason || 'Blocked'}
                      </span>
                    </div>

                    {item.subject ? (
                      <div className="mb-3 rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
                        <span className="font-semibold text-slate-900">Subject:</span> {item.subject}
                      </div>
                    ) : null}

                    <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm whitespace-pre-wrap text-slate-800">
                      {item.body || 'No message body generated.'}
                    </div>

                    {item.missingPlaceholders?.length ? (
                      <p className="mt-3 text-xs text-red-600">Missing values: {item.missingPlaceholders.join(', ')}</p>
                    ) : null}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default CommunicationComposerModal;
