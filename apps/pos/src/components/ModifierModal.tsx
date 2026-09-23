import { useMemo, useState } from "react";
import type { Product, ModifierOption } from "@brewbean/shared";

export default function ModifierModal({
  product,
  onClose,
  onConfirm,
}: {
  product: Product;
  onClose(): void;
  onConfirm(options: ModifierOption[]): void;
}) {
  const groups = product.modifierGroups ?? [];
  const [selected, setSelected] = useState<Record<string, string[]>>(() => {
    const init: Record<string, string[]> = {};
    for (const g of groups) {
      const defaults = g.options.filter((o) => o.isDefault && o.available).map((o) => o.id);
      init[g.id] = defaults.slice(0, Math.max(1, g.minSelect));
    }
    return init;
  });

  function toggle(groupId: string, option: ModifierOption, max: number) {
    setSelected((prev) => {
      const current = prev[groupId] ?? [];
      if (max === 1) {
        return { ...prev, [groupId]: [option.id] };
      }
      if (current.includes(option.id)) {
        return { ...prev, [groupId]: current.filter((id) => id !== option.id) };
      }
      if (current.length >= max) return prev;
      return { ...prev, [groupId]: [...current, option.id] };
    });
  }

  // Key by group id (the state's keys), not o.groupId — older cached catalog
  // snapshots may lack groupId on options.
  const chosenOptions = useMemo(
    () =>
      groups.flatMap((g) =>
        g.options.filter((o) => (selected[g.id] ?? []).includes(o.id))
      ),
    [groups, selected]
  );

  const valid = groups.every((g) => {
    const n = (selected[g.id] ?? []).length;
    return n >= g.minSelect && n <= g.maxSelect;
  });

  const delta = chosenOptions.reduce((s, o) => s + o.priceDelta, 0);
  const total = product.price + delta;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>
          {product.imageEmoji} {product.name}
        </h2>
        <p className="sub">Choose options — price updates live</p>

        {groups.map((g) => (
          <div key={g.id} className="opt-group">
            <div className="gname">
              {g.name} {g.maxSelect === 1 ? "· pick 1" : `· up to ${g.maxSelect}`}
            </div>
            <div className="opt-row">
              {g.options.filter((o) => o.available).map((o) => {
                const isSel = (selected[g.id] ?? []).includes(o.id);
                return (
                  <button
                    key={o.id}
                    className={`opt-btn ${isSel ? "selected" : ""}`}
                    onClick={() => toggle(g.id, o, g.maxSelect)}
                  >
                    {o.name}
                    {o.priceDelta > 0 && <span className="delta">+Rs {(o.priceDelta / 100).toFixed(0)}</span>}
                  </button>
                );
              })}
            </div>
          </div>
        ))}

        <div className="change-row">
          <span>Item total</span>
          <span className="val">Rs {(total / 100).toFixed(2)}</span>
        </div>

        <button
          className="primary-btn"
          disabled={!valid}
          onClick={() => onConfirm(chosenOptions)}
        >
          Add to order
        </button>
        <button className="ghost-btn" onClick={onClose}>Cancel</button>
      </div>
    </div>
  );
}
