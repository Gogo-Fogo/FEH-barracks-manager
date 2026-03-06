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
  source: string | null;
  source_url: string | null;
  effect: string | null;
  sp: string | null;
  attack: string | null;
  range: string | null;
  rating: string | null;
};

type SkillCatalogResponse = {
  total_items: number;
  items: SkillCatalogOption[];
};

type SkillTagSelectorProps = {
  inputName: string;
  label?: string;
  helperText?: string;
  selectedValues?: BarracksTrackedSkill[];
  selectedValue?: BarracksTrackedSkill | null;
  placeholder?: string;
  emptyStateText?: string;
  allowedCategories?: string[];
  multiple?: boolean;
};

const EMPTY_SELECTED_VALUES: BarracksTrackedSkill[] = [];

let sharedSkillCatalogPromise: Promise<SkillCatalogOption[]> | null = null;
let sharedSkillCatalogData: SkillCatalogOption[] | null = null;

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
    source: String((value as SkillCatalogOption).source || "").trim() || null,
    source_url: String(value.source_url || "").trim() || null,
    effect: String((value as SkillCatalogOption).effect || "").trim() || null,
    sp: String((value as SkillCatalogOption).sp || "").trim() || null,
    attack: String((value as SkillCatalogOption).attack || "").trim() || null,
    range: String((value as SkillCatalogOption).range || "").trim() || null,
    rating: String((value as SkillCatalogOption).rating || "").trim() || null,
  };
}

async function loadSkillCatalog() {
  if (sharedSkillCatalogData) {
    return sharedSkillCatalogData;
  }

  if (!sharedSkillCatalogPromise) {
    sharedSkillCatalogPromise = fetch("/api/skill-catalog")
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(`Failed to load skill catalog (${response.status})`);
        }
        return response.json() as Promise<SkillCatalogResponse>;
      })
      .then((payload) => {
        sharedSkillCatalogData = payload.items || [];
        return sharedSkillCatalogData;
      });
  }

  return sharedSkillCatalogPromise;
}

function buildSearchText(option: SkillCatalogOption) {
  return normalizeText(
    [option.name, option.category_label, option.subcategory, option.effect, option.source]
      .filter(Boolean)
      .join(" ")
  );
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

function summarizeEffect(value: string | null | undefined, maxLength = 120) {
  const normalized = String(value || "").replace(/\s+/g, " ").trim();
  if (!normalized) return null;
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength - 1).trimEnd()}...`;
}

function buildMetadataPills(value: {
  subcategory: string | null;
  category_label: string | null;
  sp: string | null;
  range: string | null;
  attack: string | null;
  rating: string | null;
  source: string | null;
}) {
  const pills = [];

  if (value.subcategory) pills.push(value.subcategory);
  if (value.sp) pills.push(`SP ${value.sp}`);
  if (value.range) pills.push(`Range ${value.range}`);
  if (value.attack) pills.push(`Atk ${value.attack}`);
  if (value.rating) pills.push(`Rating ${value.rating}`);
  if (value.source) pills.push(String(value.source).toUpperCase());

  return pills.slice(0, 5);
}

export function SkillTagSelector({
  inputName,
  label,
  helperText,
  selectedValues,
  selectedValue,
  placeholder = "Search skill name",
  emptyStateText = "No matching skills found.",
  allowedCategories,
  multiple = true,
}: SkillTagSelectorProps) {
  const effectiveSelectedValues = selectedValues ?? EMPTY_SELECTED_VALUES;
  const effectiveSelectedValue = selectedValue ?? null;
  const [catalog, setCatalog] = useState<SkillCatalogOption[]>(() => sharedSkillCatalogData ?? []);
  const [isLoading, setIsLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<BarracksTrackedSkill[]>(() =>
    dedupeSelected(multiple ? effectiveSelectedValues : [effectiveSelectedValue])
  );

  useEffect(() => {
    setSelected(dedupeSelected(multiple ? effectiveSelectedValues : [effectiveSelectedValue]));
  }, [multiple, effectiveSelectedValue, effectiveSelectedValues]);

  useEffect(() => {
    let active = true;

    if (catalog.length || loadError) {
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
  }, [catalog.length, loadError]);

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
      {label || helperText ? (
        <div>
          {label ? <label className="mb-1 block text-xs text-zinc-400">{label}</label> : null}
          {helperText ? <p className="text-xs text-zinc-500">{helperText}</p> : null}
        </div>
      ) : null}

      <div className="flex flex-wrap gap-2">
        {selected.map((value) => (
          <div
            key={`${inputName}-${value.id}`}
            className="inline-flex max-w-full items-start gap-2 rounded-xl border border-cyan-800/70 bg-cyan-950/25 px-2.5 py-2 text-xs text-cyan-100"
          >
            <input type="hidden" name={inputName} value={serializeTrackedSkillInput(value)} readOnly />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="truncate font-medium text-cyan-100">{value.name}</span>
                {buildMetadataPills(value).map((pill) => (
                  <span
                    key={`${inputName}-${value.id}-${pill}`}
                    className="rounded-full border border-white/10 bg-white/5 px-1.5 py-0.5 text-[10px] uppercase tracking-[0.12em] text-zinc-300"
                  >
                    {pill}
                  </span>
                ))}
              </div>
              {summarizeEffect(value.effect, 90) ? (
                <p className="mt-1 line-clamp-2 text-[11px] text-zinc-400">{summarizeEffect(value.effect, 90)}</p>
              ) : null}
            </div>
            <button
              type="button"
              onClick={() => removeSelection(value.id)}
              className="shrink-0 rounded-full border border-cyan-700/60 px-1.5 py-0.5 text-[10px] text-cyan-200 hover:bg-cyan-900/40"
            >
              Remove
            </button>
          </div>
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
                  className="flex w-full items-start justify-between gap-3 border-b border-zinc-800 px-3 py-2.5 text-left hover:bg-zinc-800"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-zinc-100">{option.name}</span>
                    <span className="mt-1 block truncate text-xs text-zinc-400">
                      {option.subcategory || option.category_label}
                    </span>
                    {summarizeEffect(option.effect) ? (
                      <span className="mt-1 block line-clamp-2 text-[11px] leading-5 text-zinc-500">
                        {summarizeEffect(option.effect)}
                      </span>
                    ) : null}
                    <span className="mt-2 flex flex-wrap gap-1">
                      {buildMetadataPills(option).map((pill) => (
                        <span
                          key={`${inputName}-${option.id}-${pill}`}
                          className="rounded-full border border-zinc-700 bg-zinc-950/70 px-1.5 py-0.5 text-[10px] uppercase tracking-[0.12em] text-zinc-300"
                        >
                          {pill}
                        </span>
                      ))}
                    </span>
                  </span>
                  <span className="shrink-0 rounded border border-zinc-700 px-1.5 py-0.5 text-[10px] uppercase tracking-[0.12em] text-zinc-400">
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
