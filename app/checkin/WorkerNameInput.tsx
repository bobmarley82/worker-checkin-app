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
      <label htmlFor={inputId} className="block text-sm font-medium">
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
        className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 outline-none focus:border-black"
        style={{ textTransform: "capitalize" }}
        required
      />

      {showSuggestions && suggestions.length > 0 ? (
        <div className="absolute z-10 mt-1 w-full rounded-lg border border-gray-200 bg-white shadow-lg">
          {suggestions.map((name) => (
            <button
              key={name}
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                setValue(name);
                setShowSuggestions(false);
              }}
              className="block w-full px-3 py-2 text-left text-sm text-gray-900 hover:bg-gray-50"
            >
              {name}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}