import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { DashboardNav } from "./DashboardNav";

vi.mock("next/navigation", () => ({ usePathname: () => "/" }));
vi.mock("next/link", () => ({
  default: ({ href, children, className }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => (
    <a href={href} className={className}>{children}</a>
  ),
}));
vi.mock("./ProjectFilter", () => ({ ProjectFilter: () => null }));
vi.mock("./TokenUsageBadge", () => ({ TokenUsageBadge: () => null }));
vi.mock("./MobileNavDrawer", () => ({
  MobileNavDrawer: ({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) =>
    isOpen ? <div role="dialog" aria-label="navigation drawer"><button onClick={onClose}>close drawer</button></div> : null,
}));

const defaultProps = {
  projects: [],
  selectedSlugs: [],
  onSelectedChange: vi.fn(),
};

describe("DashboardNav hamburger", () => {
  beforeEach(() => {
    defaultProps.onSelectedChange.mockClear();
  });

  it("shows hamburger (open) button initially", () => {
    render(<DashboardNav {...defaultProps} />);
    expect(screen.getByRole("button", { name: /open navigation/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /close navigation/i })).not.toBeInTheDocument();
  });

  it("drawer is closed initially", () => {
    render(<DashboardNav {...defaultProps} />);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("opens drawer and switches to close icon on click", async () => {
    render(<DashboardNav {...defaultProps} />);
    await userEvent.click(screen.getByRole("button", { name: /open navigation/i }));
    expect(screen.getByRole("button", { name: /close navigation/i })).toBeInTheDocument();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("closes drawer on second click", async () => {
    render(<DashboardNav {...defaultProps} />);
    const btn = screen.getByRole("button", { name: /open navigation/i });
    await userEvent.click(btn);
    await userEvent.click(screen.getByRole("button", { name: /close navigation/i }));
    expect(screen.getByRole("button", { name: /open navigation/i })).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("closes drawer when drawer signals onClose", async () => {
    render(<DashboardNav {...defaultProps} />);
    await userEvent.click(screen.getByRole("button", { name: /open navigation/i }));
    await userEvent.click(screen.getByRole("button", { name: "close drawer" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /open navigation/i })).toBeInTheDocument();
  });
});
