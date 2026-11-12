import { describe, expect, it } from 'vitest';
import { canOpenView, workspaceView } from './routes';

describe('workspaceView', () => {
  it.each([
    ['/dashboard', 'dashboard'],
    ['/assets', 'assets'],
    ['/assets/asset-123', 'assets'],
    ['/requests/new', 'request-new'],
    ['/requests/request-123', 'requests'],
    ['/approvals/history', 'approval-history'],
    ['/users/access', 'access'],
    ['/operations/email', 'email'],
    ['/operations/provider', 'provider-recovery'],
    ['/users/', 'users'],
  ])('maps %s to %s', (path, expected) => {
    expect(workspaceView(path)).toBe(expected);
  });

  it('keeps request creation more specific than request detail', () => {
    expect(workspaceView('/requests/new')).toBe('request-new');
  });

  it('returns not-found for unknown and over-nested paths', () => {
    expect(workspaceView('/settings')).toBe('not-found');
    expect(workspaceView('/assets/audit/history')).toBe('not-found');
    expect(canOpenView('ADMIN', workspaceView('/settings'))).toBe(true);
    expect(canOpenView('USER', workspaceView('/settings'))).toBe(true);
  });
});

describe('canOpenView', () => {
  it('allows shared routes for every role', () => {
    for (const role of ['USER', 'APPROVER', 'ADMIN'] as const) {
      expect(canOpenView(role, 'dashboard')).toBe(true);
      expect(canOpenView(role, 'notifications')).toBe(true);
      expect(canOpenView(role, 'assets')).toBe(true);
    }
  });

  it('enforces the role matrix for privileged pages', () => {
    expect(canOpenView('ADMIN', 'users')).toBe(true);
    expect(canOpenView('USER', 'users')).toBe(false);
    expect(canOpenView('APPROVER', 'approvals')).toBe(true);
    expect(canOpenView('ADMIN', 'approvals')).toBe(false);
    expect(canOpenView('USER', 'request-new')).toBe(true);
    expect(canOpenView('APPROVER', 'request-new')).toBe(false);
    expect(canOpenView('ADMIN', 'provider-recovery')).toBe(true);
    expect(canOpenView('APPROVER', 'provider-recovery')).toBe(false);
    expect(canOpenView('USER', 'provider-recovery')).toBe(false);
  });
  it('keeps request links closed in Admin view while Approver can trace scoped requests', () => {
    expect(canOpenView('ADMIN', 'requests')).toBe(false);
    expect(canOpenView('APPROVER', 'requests')).toBe(true);
    expect(canOpenView('APPROVER', 'assets', ['USER'])).toBe(false);
  });
});
