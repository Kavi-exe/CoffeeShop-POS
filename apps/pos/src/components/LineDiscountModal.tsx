import { useState } from "react";
import { usePos } from "../lib/store.js";

export default function LineDiscountModal({ lineId, onClose }: { lineId: string; onClose(): void }) {
  const setLineDiscount = usePos((s) => s.setLineDiscount);
  const [input, setInput] = useState("");

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>Item discount</h2>
        <p className="sub">Rupees off this line — recorded on the order</p>
        <div className="field">
          <input autoFocus inputMode="decimal" value={input} onChange={(e) => setInput(e.target.value)} placeholder="e.g. 100" />
        </div>
        <button
          className="primary-btn"
          onClick={() => {
            setLineDiscount(lineId, Math.round((parseFloat(input || "0") || 0) * 100));
            onClose();
          }}
        >
          Apply
        </button>
        <button className="ghost-btn" onClick={onClose}>Cancel</button>
      </div>
    </div>
  );
}
