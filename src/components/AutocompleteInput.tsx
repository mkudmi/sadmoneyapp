import { useEffect, useId, useRef, useState } from "react";
import { useDismissible } from "../hooks/useDismissible";
import { AppIcon } from "./AppIcon";

type Props = {
  id?: string;
  label: string;
  value: string;
  options: string[];
  placeholder?: string;
  onChange: (value: string) => void;
  onSubmit?: () => void;
};

export function AutocompleteInput({ id, label, value, options, placeholder, onChange, onSubmit }: Props) {
  const uid = useId();
  const inputId = id ?? `${uid}-input`;
  const listId = `${uid}-list`;
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const activeIndex = active === null ? -1 : options.indexOf(active);
  const expanded = open && options.length > 0;
  useDismissible(open, () => { setOpen(false); setActive(null); }, `[data-autocomplete="${uid}"]`);
  useEffect(() => {
    if (expanded && activeIndex >= 0) listRef.current?.children[activeIndex]?.scrollIntoView({ block: "nearest" });
  }, [expanded, activeIndex]);

  function choose(option: string) {
    onChange(option);
    setOpen(false);
    setActive(null);
    inputRef.current?.focus();
  }

  return (
    <div data-autocomplete={uid} style={{ position: "relative", minWidth: 0 }} onBlur={(event) => {
      if (!event.currentTarget.contains(event.relatedTarget)) { setOpen(false); setActive(null); }
    }} onKeyDown={(event) => {
      if (event.nativeEvent.isComposing) return;
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        event.stopPropagation();
        setOpen(true);
        if (options.length > 0) {
          const index = !expanded || activeIndex < 0
            ? event.key === "ArrowDown" ? 0 : options.length - 1
            : (activeIndex + (event.key === "ArrowDown" ? 1 : -1) + options.length) % options.length;
          setActive(options[index]);
        }
      } else if (event.key === "Enter") {
        event.preventDefault();
        event.stopPropagation();
        if (expanded && activeIndex >= 0) choose(options[activeIndex]);
        else if (!expanded) onSubmit?.();
      } else if (event.key === "Escape" && open) {
        event.preventDefault();
        event.stopPropagation();
        setOpen(false);
        setActive(null);
      } else if (event.key === "Tab") { setOpen(false); setActive(null); }
    }}>
      <label htmlFor={inputId} style={{ display: "block", fontSize: 12, opacity: .8, marginBottom: 4 }}>{label}</label>
      <div style={{ display: "flex", gap: 8 }}>
        <input ref={inputRef} id={inputId} role="combobox" aria-autocomplete="list" aria-expanded={expanded} aria-controls={expanded ? listId : undefined} aria-activedescendant={expanded && activeIndex >= 0 ? `${uid}-option-${activeIndex}` : undefined}
          value={value} placeholder={placeholder}
          onFocus={() => { setOpen(true); setActive(null); }}
          onClick={() => setOpen(true)}
          onChange={(event) => { onChange(event.target.value); setOpen(true); setActive(null); }}
          style={{ width: "100%", minWidth: 0, boxSizing: "border-box", padding: 8, borderRadius: 8, border: "1px solid #ddd" }} />
        <button type="button" aria-label="Show category list" aria-expanded={expanded} aria-controls={expanded ? listId : undefined} className="icon-button" style={{ minWidth: 34, padding: 0 }}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => { inputRef.current?.focus(); setOpen(!open); setActive(null); }}><AppIcon name="chevronDown" /></button>
      </div>
      {expanded ? <div ref={listRef} id={listId} role="listbox" aria-label={label} className="menu-pop autocomplete-options" onMouseDown={(event) => event.preventDefault()}>
        {options.map((option, index) => <button key={option} id={`${uid}-option-${index}`} type="button" role="option" aria-selected={index === activeIndex} tabIndex={-1}
          onMouseEnter={() => setActive(option)} onClick={() => choose(option)}>{option}</button>)}
      </div> : null}
    </div>
  );
}
