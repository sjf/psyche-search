import { Search, X } from "lucide-react";
import { FormEvent } from "react";

interface SearchBarProps {
  value: string;
  placeholder: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  onClear?: () => void;
  disabled?: boolean;
}

export default function SearchBar({
  value,
  placeholder,
  onChange,
  onSubmit,
  onClear,
  disabled = false
}: SearchBarProps) {
  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (disabled) {
      return;
    }
    onSubmit();
  };

  return (
    <form className="search-form full-width" onSubmit={handleSubmit}>
      <div className="search-input-wrapper">
        <input
          type="text"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={placeholder}
          disabled={disabled}
        />
        {value && (
          <button
            type="button"
            className="search-clear"
            aria-label="Clear search"
            disabled={disabled}
            onClick={() => {
              onChange("");
              onClear?.();
            }}
          >
            <X size={14} strokeWidth={1.6} />
          </button>
        )}
      </div>
      <button type="submit" className="icon-button" aria-label="Search" disabled={disabled}>
        <Search size={16} strokeWidth={1.6} />
      </button>
    </form>
  );
}
