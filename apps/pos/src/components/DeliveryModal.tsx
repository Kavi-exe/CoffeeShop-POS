import { useState } from "react";
import { usePos } from "../lib/store.js";

export default function DeliveryModal({ onClose, onSave }: { onClose(): void; onSave(): void }) {
  const setDeliveryInfo = usePos((s) => s.setDeliveryInfo);
  const existing = usePos((s) => s.deliveryInfo);
  const [name, setName] = useState(existing?.customerName ?? "");
  const [phone, setPhone] = useState(existing?.phone ?? "");
  const [address, setAddress] = useState(existing?.address ?? "");
  const [note, setNote] = useState(existing?.note ?? "");
  const [fee, setFee] = useState(existing ? (existing.feeCents / 100).toFixed(0) : "300");

  function save() {
    setDeliveryInfo({
      customerName: name,
      phone,
      address,
      note: note || undefined,
      feeCents: Math.round((parseFloat(fee || "0") || 0) * 100),
    });
    onSave();
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>🛵 Delivery details</h2>
        <p className="sub">Customer info prints on the receipt</p>
        <div className="field">
          <label>Customer name</label>
          <input autoFocus value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="field">
          <label>Phone</label>
          <input inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
        </div>
        <div className="field">
          <label>Address</label>
          <textarea rows={2} value={address} onChange={(e) => setAddress(e.target.value)} />
        </div>
        <div className="field">
          <label>Delivery fee (Rs)</label>
          <input inputMode="decimal" value={fee} onChange={(e) => setFee(e.target.value)} />
        </div>
        <div className="field">
          <label>Notes</label>
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Ring the bell twice" />
        </div>
        <button className="primary-btn" onClick={save} disabled={!name || !phone || !address}>
          Save details
        </button>
      </div>
    </div>
  );
}
