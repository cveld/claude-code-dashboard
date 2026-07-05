import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { MobileNavDrawer } from "./MobileNavDrawer";

vi.mock("next/navigation", () => ({ usePathname: () => "/sessions" }));
vi.mock("next/link", () => ({
  default: ({ href, children, onClick, className }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => (
    <a href={href} onClick={onClick} className={className}>{children}</a>
  ),
}));
vi.mock("./ProjectFilter", () => ({ ProjectFilter: () => <div data-testid="project-filter" /> }));
vi.mock("./TokenUsageBadge", () => ({ TokenUsageBadge: () => <div data-testid="token-badge" /> }));

const defaultProps = {
  isOpen: true,
  onClose: vi.fn(),
  projects: [],
  selectedSlugs: [],
  onSelectedChange: vi.fn(),
};

describe("MobileNavDrawer", () => {
  beforeEach(() => {
    defaultProps.onClose.mockClear();
  });

  it("renders nothing when closed", () => {
    render(<MobileNavDrawer {...defaultProps} isOpen={false} />);
    expect(screen.queryByText("Navigation")).not.toBeInTheDocument();
  });

  it("renders nav links when open", () => {
    render(<MobileNavDrawer {...defaultProps} />);
    expect(screen.getByRole("link", { name: "Projects" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Sessions/ })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Settings" })).toBeInTheDocument();
  });

  it("highlights the active route", () => {
    render(<MobileNavDrawer {...defaultProps} />);
    // /sessions is active per the mock
    const sessionsLink = screen.getByRole("link", { name: /Sessions/ });
    expect(sessionsLink).toHaveClass("bg-zinc-700");
    const projectsLink = screen.getByRole("link", { name: "Projects" });
    expect(projectsLink).not.toHaveClass("bg-zinc-700");
  });

  it("calls onClose when overlay is clicked", async () => {
    render(<MobileNavDrawer {...defaultProps} />);
    const overlay = screen.getByTestId("drawer-overlay");
    await userEvent.click(overlay);
    expect(defaultProps.onClose).toHaveBeenCalledOnce();
  });

  it("calls onClose on Escape key", async () => {
    render(<MobileNavDrawer {...defaultProps} />);
    await userEvent.keyboard("{Escape}");
    expect(defaultProps.onClose).toHaveBeenCalledOnce();
  });

  it("shows unread count badge when provided", () => {
    render(<MobileNavDrawer {...defaultProps} unreadCount={5} />);
    expect(screen.getByText("5")).toBeInTheDocument();
  });

  it("shows ProjectFilter when more than one project", () => {
    const projects = [
      { slug: "a", name: "A", sessionCount: 1 },
      { slug: "b", name: "B", sessionCount: 1 },
    ] as Parameters<typeof MobileNavDrawer>[0]["projects"];
    render(<MobileNavDrawer {...defaultProps} projects={projects} />);
    expect(screen.getByTestId("project-filter")).toBeInTheDocument();
  });

  it("hides ProjectFilter for a single project", () => {
    const projects = [{ slug: "a", name: "A", sessionCount: 1 }] as Parameters<typeof MobileNavDrawer>[0]["projects"];
    render(<MobileNavDrawer {...defaultProps} projects={projects} />);
    expect(screen.queryByTestId("project-filter")).not.toBeInTheDocument();
  });
});
