"use client";

import { useEffect, useMemo, useState } from "react";
import {
  serializeTrackedSkillInput,
  type BarracksTrackedSkill,
} from "@/lib/barracks-entry-metadata";

type SkillCatalogOption = {
  id: string;
  name: string;
  category: string;
  category_label: string;
  subcategory: string | null;
  source_url: string | null;
};

type SkillCatalogResponse = {
  total_items: number;
  items: SkillCatalogOption[];
};

type SkillTagSelectorProps = {
  inputName: string;
  label: string;
  helperText?: string;
  selectedValues?: BarracksTrackedSkill[];
  selectedValue?: BarracksTrackedSkill | null;
  placeholder?: string;
  emptyStateText?: string;
  allowedCategories?: string[];
  multiple?: boolean;
};

let sharedSkillCatalogPromise: Promise<SkillCatalogOption[]> | null = null;

function normalizeText(value: string) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function normalizeSkillValue(value: BarracksTrackedSkill | SkillCatalogOption | null | undefined): BarracksTrackedSkill | null {
  if (!value?.name) return null;
  return {
    id: String(value.id || "").trim() || `${value.category}__${normalizeText(value.name).replace(/\s+/g, "_")}`,
    name: String(value.name || "").trim(),
    category: String(value.category || "").trim() || "legacy",
    category_label: String((value as SkillCatalogOption).category_label || "").trim() || null,
    subcategory: String(value.subcategory || "").trim() || null,
    source_url: String(value.source_url || "").trim() || null,
  };
}

async function loadSkillCatalog() {
  if (!sharedSkillCatalogPromise) {
    sharedSkillCatalogPromise = fetch("/api/skill-catalog")
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(`Failed to load skill catalog (${response.status})`);
        }
        return response.json() as Promise<SkillCatalogResponse>;
      })
      .then((payload) => payload.items || []);
  }

  return sharedSkillCatalogPromise;
}

function buildSearchText(option: SkillCatalogOption) {
  return normalizeText([option.name, option.category_label, option.subcategory].filter(Boolean).join(" "));
}

function dedupeSelected(values: Array<BarracksTrackedSkill | null>) {
  const seen = new Set<string>();
  const result: BarracksTrackedSkill[] = [];

  for (const value of values) {
    const normalized = normalizeSkillValue(value);
    if (!normalized) continue;
    const key = normalized.id || `${normalized.category}:${normalized.name.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(normalized);
  }

  return result;
}

export function SkillTagSelector({
  inputName,
  label,
  helperText,
  selectedValues = [],
  selectedValue = null,
  placeholder = "Search skill name",
  emptyStateText = "No matching skills found.",
  allowedCategories,
  multiple = true,
}: SkillTagSelectorProps) {
  const [catalog, setCatalog] = useState<SkillCatalogOption[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<BarracksTrackedSkill[]>(() =>
    dedupeSelected(multiple ? selectedValues : [selectedValue])
  );

  useEffect(() => {
    setSelected(dedupeSelected(multiple ? selectedValues : [selectedValue]));
  }, [multiple, selectedValue, selectedValues]);

  useEffect(() => {
    let active = true;

    if (!open) {
      return () => {
        active = false;
      };
    }

    if (catalog.length || isLoading || loadError) {
      return () => {
        active = false;
      };
    }

    setIsLoading(true);
    loadSkillCatalog()
      .then((items) => {
        if (!active) return;
        setCatalog(items);
      })
      .catch((error) => {
        if (!active) return;
        setLoadError(error instanceof Error ? error.message : "Failed to load skill catalog.");
      })
      .finally(() => {
        if (!active) return;
        setIsLoading(false);
      });

    return () => {
      active = false;
    };
  }, [catalog.length, isLoading, loadError, open]);

  const selectedSet = useMemo(() => new Set(selected.map((value) => value.id)), [selected]);
  const normalizedQuery = normalizeText(query);

  const matches = useMemo(() => {
    if (!catalog.length) return [] as SkillCatalogOption[];

    const filteredCatalog = catalog.filter((option) =>
      allowedCategories?.length ? allowedCategories.includes(option.category) : true
    );

    const ranked = filteredCatalog
      .filter((option) => !selectedSet.has(option.id))
      .map((option) => {
        const searchText = buildSearchText(option);
        if (!normalizedQuery) {
          return { option, rank: 1 };
        }

        const exactName = normalizeText(option.name);
        if (exactName === normalizedQuery) {
          return { option, rank: 100 };
        }

        if (exactName.startsWith(normalizedQuery)) {
          return { option, rank: 80 };
        }

        if (searchText.includes(normalizedQuery)) {
          return { option, rank: 40 };
        }

        return null;
      })
      .filter((entry): entry is { option: SkillCatalogOption; rank: number } => Boolean(entry))
      .sort((a, b) => {
        if (b.rank !== a.rank) return b.rank - a.rank;
        return a.option.name.localeCompare(b.option.name);
      })
      .map((entry) => entry.option);

    return ranked.slice(0, 12);
  }, [allowedCategories, catalog, normalizedQuery, selectedSet]);

  function addSelection(option: SkillCatalogOption) {
    const normalized = normalizeSkillValue(option);
    if (!normalized) return;

    setSelected((current) => {
      if (!multiple) {
        return [normalized];
      }
      if (current.some((item) => item.id === normalized.id)) {
        return current;
      }
      return [...current, normalized];
    });
    setQuery("");
    setOpen(false);
  }

  function removeSelection(skillId: string) {
    setSelected((current) => current.filter((item) => item.id !== skillId));
  }

  return (
    <div className="space-y-2">
      <div>
        <label className="mb-1 block text-xs text-zinc-400">{label}</label>
        {helperText ? <p className="text-xs text-zinc-500">{helperText}</p> : null}
      </div>

      <div className="flex flex-wrap gap-2">
        {selected.map((value) => (
          <span
            key={`${inputName}-${value.id}`}
            className="inline-flex items-center gap-2 rounded-full border border-cyan-800/70 bg-cyan-950/30 px-2.5 py-1 text-xs text-cyan-100"
          >
            <input type="hidden" name={inputName} value={serializeTrackedSkillInput(value)} readOnly />
            <span className="truncate">{value.name}</span>
            <span className="rounded-full border border-white/10 bg-white/5 px-1.5 py-0.5 text-[10px] uppercase tracking-[0.14em] text-zinc-300">
              {value.subcategory || value.category_label || "Legacy"}
            </span>
            <button
              type="button"
              onClick={() => removeSelection(value.id)}
              className="rounded-full border border-cyan-700/60 px-1.5 py-0.5 text-[10px] text-cyan-200 hover:bg-cyan-900/40"
            >
              Remove
            </button>
          </span>
        ))}
      </div>

      <div className="relative">
        <input
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 120)}
          placeholder={placeholder}
          autoComplete="off"
          className="w-full rounded border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-sm"
        />

        {open ? (
          <div className="app-scrollbar absolute z-40 mt-1 max-h-64 w-full overflow-y-auto overflow-x-hidden rounded border border-zinc-700 bg-zinc-900 shadow-xl">
            {isLoading ? (
              <p className="px-2 py-2 text-xs text-zinc-400">Loading skill catalog...</p>
            ) : loadError ? (
              <p className="px-2 py-2 text-xs text-rose-300">{loadError}</p>
            ) : matches.length ? (
              matches.map((option) => (
                <button
                  key={`${inputName}-${option.id}`}
                  type="button"
                  onClick={() => addSelection(option)}
                  className="flex w-full items-start justify-between gap-3 border-b border-zinc-800 px-2 py-2 text-left hover:bg-zinc-800"
                >
                  <span className="min-w-0">
                    <span className="block truncate text-sm text-zinc-100">{option.name}</span>
                    <span className="block truncate text-xs text-zinc-400">
                      {option.subcategory || option.category_label}
                    </span>
                  </span>
                  <span className="rounded border border-zinc-700 px-1.5 py-0.5 text-[10px] uppercase tracking-[0.12em] text-zinc-400">
                    {option.category_label}
                  </span>
                </button>
              ))
            ) : (
              <p className="px-2 py-2 text-xs text-zinc-400">{emptyStateText}</p>
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
}
