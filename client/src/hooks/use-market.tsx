import { createContext, useContext, useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import type { Market } from "@shared/schema";

interface MarketContextValue {
  markets: Market[];
  activeMarket: Market | null;
  setActiveMarketId: (id: string) => void;
  isLoading: boolean;
}

const MarketContext = createContext<MarketContextValue>({
  markets: [],
  activeMarket: null,
  setActiveMarketId: () => {},
  isLoading: true,
});

export function MarketProvider({ children }: { children: React.ReactNode }) {
  const [selectedId, setSelectedId] = useState<string | null>(() => {
    try {
      return localStorage.getItem("roofIntel_activeMarket");
    } catch {
      return null;
    }
  });

  const { data: markets, isLoading } = useQuery<Market[]>({
    queryKey: ["/api/markets"],
  });

  const activeMarket = markets?.find((m) => m.id === selectedId) || markets?.[0] || null;

  useEffect(() => {
    if (activeMarket && activeMarket.id !== selectedId) {
      setSelectedId(activeMarket.id);
    }
  }, [activeMarket, selectedId]);

  const setActiveMarketId = (id: string) => {
    setSelectedId(id);
    try {
      localStorage.setItem("roofIntel_activeMarket", id);
    } catch {}
  };

  return (
    <MarketContext.Provider value={{ markets: markets || [], activeMarket, setActiveMarketId, isLoading }}>
      {children}
    </MarketContext.Provider>
  );
}

export function useMarket() {
  return useContext(MarketContext);
}
