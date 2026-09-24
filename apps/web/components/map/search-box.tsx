"use client";

import type { GeocodeResult } from "@geo-platform/api-client";
import { GeoApiError } from "@geo-platform/api-client";
import { Loader2, MapPin, Search, X } from "lucide-react";
import { useId, useRef, useState, type ReactNode } from "react";
import { MIN_SEARCH_LENGTH, useGeocodeSearch } from "@/hooks/use-geocode-search";
import { cn } from "@/lib/utils";

type SearchBoxProps = {
  /** Visible or screen-reader label for the input. */
  label: string;
  hideLabel?: boolean;
  placeholder?: string;
  text: string;
  onTextChange: (text: string) => void;
  onSelect: (result: GeocodeResult) => void;
  onClear?: () => void;
  icon?: ReactNode;
  size?: "default" | "lg";
  /** Render results in the document flow (for bottom sheets) instead of as an overlay. */
  inlineResults?: boolean;
  className?: string;
  autoFocus?: boolean;
};

function errorMessage(error: unknown): string {
  if (error instanceof GeoApiError) {
    if (error.code === "SERVICE_UNAVAILABLE") return "Search is temporarily unavailable.";
    if (error.code === "RATE_LIMIT_EXCEEDED") return "Too many searches. Wait a moment and try again.";
    return error.message;
  }
  return "Search failed. Check your connection.";
}

/**
 * Place search combobox (WAI-ARIA 1.2 pattern). Requests are debounced and
 * stale requests are cancelled; results come from GET /v1/geocode.
 */
export function SearchBox({
  label,
  hideLabel = true,
  placeholder = "Search places",
  text,
  onTextChange,
  onSelect,
  onClear,
  icon,
  size = "default",
  inlineResults = false,
  className,
  autoFocus,
}: SearchBoxProps) {
  const id = useId();
  const listId = `${id}-results`;
  const inputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const search = useGeocodeSearch(text, open);
  const results = search.active ? (search.data?.results ?? []) : [];
  const loading = search.active && (search.isFetching || search.settling);
  const showList = open && text.trim().length >= MIN_SEARCH_LENGTH;

  function choose(result: GeocodeResult) {
    onTextChange(result.name);
    onSelect(result);
    setOpen(false);
    setActiveIndex(-1);
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setOpen(true);
      setActiveIndex((index) => (results.length ? (index + 1) % results.length : -1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((index) => (results.length ? (index <= 0 ? results.length - 1 : index - 1) : -1));
    } else if (event.key === "Enter") {
      const result = results[activeIndex] ?? (activeIndex === -1 ? results[0] : undefined);
      if (showList && result) {
        event.preventDefault();
        choose(result);
      }
    } else if (event.key === "Escape") {
      if (open) {
        event.preventDefault();
        setOpen(false);
        setActiveIndex(-1);
      }
    }
  }

  let status: string | null = null;
  if (showList) {
    if (search.isError && !loading) status = errorMessage(search.error);
    else if (loading && results.length === 0) status = "Searching…";
    else if (!loading && results.length === 0 && search.isSuccess) status = "No places found.";
  }

  return (
    <div className={cn("relative", className)}>
      <label htmlFor={`${id}-input`} className={cn("mb-1.5 block text-xs font-medium", hideLabel && "sr-only")}>
        {label}
      </label>
      <div className="relative">
        <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted-foreground [&_svg]:size-4">
          {icon ?? <Search />}
        </span>
        <input
          ref={inputRef}
          id={`${id}-input`}
          type="text"
          role="combobox"
          aria-expanded={showList}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={showList && activeIndex >= 0 ? `${id}-option-${activeIndex}` : undefined}
          autoComplete="off"
          spellCheck={false}
          autoFocus={autoFocus}
          placeholder={placeholder}
          value={text}
          onChange={(event) => {
            onTextChange(event.target.value);
            setOpen(true);
            setActiveIndex(-1);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setOpen(false)}
          onKeyDown={onKeyDown}
          className={cn(
            "w-full rounded-lg border border-input bg-background pr-9 pl-9 text-sm shadow-xs outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/40",
            size === "lg" ? "h-11" : "h-9",
          )}
        />
        <span className="absolute top-1/2 right-2 flex -translate-y-1/2 items-center">
          {loading ? (
            <Loader2 className="size-4 animate-spin text-muted-foreground" aria-hidden="true" />
          ) : text ? (
            <button
              type="button"
              aria-label={`Clear ${label.toLowerCase()}`}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => {
                onTextChange("");
                onClear?.();
                inputRef.current?.focus();
              }}
              className="rounded p-1 text-muted-foreground hover:text-foreground"
            >
              <X className="size-4" />
            </button>
          ) : null}
        </span>
      </div>
      <div
        className={cn(
          "overflow-hidden rounded-lg border bg-popover text-popover-foreground",
          inlineResults ? "mt-2" : "absolute top-full right-0 left-0 z-30 mt-1 shadow-lg",
          !showList && "hidden",
        )}
      >
        <ul id={listId} role="listbox" aria-label={`${label} results`} className="max-h-80 overflow-y-auto py-1">
          {results.map((result, index) => (
            <li
              key={result.id}
              id={`${id}-option-${index}`}
              role="option"
              aria-selected={index === activeIndex}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => choose(result)}
              onMouseEnter={() => setActiveIndex(index)}
              className={cn(
                "flex cursor-pointer items-start gap-3 px-3 py-2 text-sm",
                index === activeIndex && "bg-muted",
              )}
            >
              <MapPin className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              <span className="min-w-0">
                <span className="block truncate font-medium">{result.name}</span>
                {result.address && (
                  <span className="block truncate text-xs text-muted-foreground">{result.address}</span>
                )}
              </span>
            </li>
          ))}
        </ul>
        {status && <p className="px-3 py-2.5 text-sm text-muted-foreground">{status}</p>}
      </div>
      <p className="sr-only" aria-live="polite">
        {showList && !loading && search.isSuccess ? `${results.length} results` : ""}
      </p>
    </div>
  );
}
