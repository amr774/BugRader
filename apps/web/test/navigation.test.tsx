// @vitest-environment jsdom
import React, { act } from "react";
import { it, expect, vi } from "vitest";
import { createRoot } from "react-dom/client";
import { MemoryRouter, useNavigate } from "react-router-dom";
import { ScrollToTop } from "../src/ScrollToTop";
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
it("resets scroll on page navigation but preserves it for filters and pagination", async () => {
  const scroll = vi.spyOn(window, "scrollTo").mockImplementation(() => {});
  let navigate: ReturnType<typeof useNavigate>;
  function Harness() {
    navigate = useNavigate();
    return <ScrollToTop />;
  }
  const host = document.createElement("div"),
    root = createRoot(host);
  try {
    await act(async () =>
      root.render(
        <MemoryRouter initialEntries={["/issues"]}>
          <Harness />
        </MemoryRouter>,
      ),
    );
    scroll.mockClear();
    await act(async () => navigate("/issues?page=2"));
    expect(scroll).not.toHaveBeenCalled();
    await act(async () => navigate("/projects"));
    expect(scroll).toHaveBeenCalledWith(0, 0);
  } finally {
    await act(async () => root.unmount());
    scroll.mockRestore();
  }
});
