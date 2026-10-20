import React, { useState } from "react";
import Modal from "../../components/common/Modal";
import AppSelect from "../../components/common/AppSelect";
import { useTerms } from "../../hooks/useTerm";

// One user, pick one firm, invite. Links the user to that SaleAdvocate's userIds and resends their
// login the same way account creation does — the user already exists, this only attaches them to a firm
// and lets them know they can now log in as that firm's advocate.
export default function AttachAdvocateModal({ user, advocateOptions, inviting, onClose, onInvite }) {
  const T = useTerms("saleAdvocate");
  const [advocateId, setAdvocateId] = useState("");
  const name = `${user.otherNames || ""} ${user.surname || ""}`.trim() || user.email;

  return (
    <Modal
      title={`Invite ${name} as ${T.saleAdvocate}`}
      onClose={onClose}
      footer={
        <>
          <button type="button" onClick={onClose} className="border border-slate-200 bg-white px-4 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-50">Cancel</button>
          <button
            type="button"
            disabled={!advocateId || inviting}
            onClick={() => onInvite(advocateId)}
            className="bg-[#0B3B2E] px-4 py-1.5 text-xs font-black text-white hover:bg-[#0A3127] disabled:opacity-60"
          >
            {inviting ? "Inviting…" : "Invite"}
          </button>
        </>
      }
    >
      <p className="mb-3 text-[11px] text-slate-600">
        Attach a {T.saleAdvocate.toLowerCase()} firm to {name}, then invite — they'll be scoped to that firm's own work and emailed their login, the same way their account creation did.
      </p>
      <AppSelect
        label={T.saleAdvocate}
        value={advocateId}
        onChange={(v) => setAdvocateId(v ?? "")}
        options={advocateOptions}
        placeholder="Select a firm"
        size="md"
        searchable
        clearable
      />
    </Modal>
  );
}
