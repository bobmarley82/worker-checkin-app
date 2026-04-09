"use client";

import { useMemo, useState } from "react";

type WorkerNameInputProps = {
  workers: string[];
  defaultValue?: string;
  inputId?: string;
  inputName?: string;
  label?: string;
  placeholder?: string;
};

function normalizeForMatch(value: string) {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

export default function WorkerNameInput({
  workers,
  defaultValue = "",
  inputId = "worker_name",
  inputName = "worker_name",
  label = "Full Name",
  placeholder = "Enter your full name",
}: WorkerNameInputProps) {
  const [value, setValue] = useState(defaultValue);
  const [showSuggestions, setShowSuggestions] = useState(false);

  const suggestions = useMemo(() => {
    const query = normalizeForMatch(value);

    if (query.length < 2) return [];

    return workers
      .filter((name) => normalizeForMatch(name).includes(query))
      .slice(0, 6);
  }, [value, workers]);

  return (
    <div className="relative">
      <label htmlFor={inputId} className="block text-sm font-medium text-slate-900">
        {label}
      </label>

      <input
        id={inputId}
        name={inputName}
        type="text"
        value={value}
        onChange={(e) => {
          setValue(e.target.value);
          setShowSuggestions(true);
        }}
        onFocus={() => setShowSuggestions(true)}
        onBlur={() => {
          setTimeout(() => setShowSuggestions(false), 150);
        }}
        placeholder={placeholder}
        autoComplete="off"
        className="mt-2 w-full rounded-xl border border-[rgba(122,95,60,0.16)] bg-white/90 px-3 py-3 outline-none focus:border-black"
        style={{ textTransform: "capitalize" }}
        required
      />

      {showSuggestions && suggestions.length > 0 ? (
        <div className="absolute z-10 mt-2 w-full overflow-hidden rounded-2xl border border-[rgba(122,95,60,0.14)] bg-white shadow-lg">
          {suggestions.map((name) => (
            <button
              key={name}
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                setValue(name);
                setShowSuggestions(false);
              }}
              className="block w-full px-3 py-3 text-left text-sm text-gray-900 hover:bg-[rgba(247,244,237,0.8)]"
            >
              {name}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
