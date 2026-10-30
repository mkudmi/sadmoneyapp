import { useEffect, useId, useRef, useState } from "react";
import { useDismissible } from "../hooks/useDismissible";
import { AppIcon } from "./AppIcon";

type Props = { label: string; value: string; options: readonly string[]; onChange: (value: string) => void };

export function SelectInput({ label, value, options, onChange }: Props) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  useDismissible(open, () => setOpen(false), `[data-select-id="${id}"]`);
  useEffect(() => {
    if (open) listRef.current?.children[active]?.scrollIntoView({ block: "nearest" });
  }, [active, open]);

  function show() {
    setActive(Math.max(0, options.indexOf(value)));
    setOpen(true);
  }
  function choose(option: string) {
    onChange(option);
    setOpen(false);
    triggerRef.current?.focus();
  }

  return <div data-select-id={id} className="select-input" onBlur={(event) => {
    if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
  }}>
    <label id={`${id}-label`} htmlFor={`${id}-trigger`} className="select-input-label">{label}</label>
    <button ref={triggerRef} id={`${id}-trigger`} type="button" className="select-input-trigger"
      role="combobox" aria-labelledby={`${id}-label`} aria-expanded={open} aria-controls={open ? `${id}-list` : undefined}
      aria-activedescendant={open ? `${id}-option-${active}` : undefined}
      onClick={() => open ? setOpen(false) : show()}
      onKeyDown={(event) => {
        if (event.key === "ArrowDown" || event.key === "ArrowUp") {
          event.preventDefault(); event.stopPropagation();
          if (!open) show();
          else setActive((index) => (index + (event.key === "ArrowDown" ? 1 : -1) + options.length) % options.length);
        } else if (open && (event.key === "Home" || event.key === "End")) {
          event.preventDefault(); setActive(event.key === "Home" ? 0 : options.length - 1);
        } else if (open && (event.key === "Enter" || event.key === " ")) {
          event.preventDefault(); event.stopPropagation(); choose(options[active]);
        } else if (open && event.key === "Escape") {
          event.preventDefault(); event.stopPropagation(); setOpen(false);
        }
      }}>
      <span>{value}</span><AppIcon name="chevronDown" />
    </button>
    {open ? <div ref={listRef} id={`${id}-list`} role="listbox" aria-labelledby={`${id}-label`} className="menu-pop autocomplete-options"
      onMouseDown={(event) => event.preventDefault()}>
      {options.map((option, index) => <button key={option} id={`${id}-option-${index}`} type="button" role="option"
        aria-selected={option === value} data-active={index === active} tabIndex={-1}
        onMouseEnter={() => setActive(index)} onClick={() => choose(option)}>{option}</button>)}
    </div> : null}
  </div>;
}
