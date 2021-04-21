/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as nls from 'vs/nls';
import * as DOM from 'vs/base/browser/dom';
import { Action, IAction, Separator, SubmenuAction } from 'vs/base/common/actions';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { IContextMenuService, IContextViewService } from 'vs/platform/contextview/browser/contextView';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { ITelemetryService } from 'vs/platform/telemetry/common/telemetry';
import { IThemeService, IColorTheme, registerThemingParticipant, ICssStyleCollector } from 'vs/platform/theme/common/themeService';
import { configureTerminalSettingsTitle, ContextMenuTabsGroup, selectDefaultProfileTitle, switchTerminalActionViewItemSeparator } from 'vs/workbench/contrib/terminal/browser/terminalActions';
import { TERMINAL_BACKGROUND_COLOR, TERMINAL_BORDER_COLOR } from 'vs/workbench/contrib/terminal/common/terminalColorRegistry';
import { INotificationService, IPromptChoice, Severity } from 'vs/platform/notification/common/notification';
import { ITerminalService, TerminalConnectionState } from 'vs/workbench/contrib/terminal/browser/terminal';
import { ViewPane, IViewPaneOptions } from 'vs/workbench/browser/parts/views/viewPane';
import { IKeybindingService } from 'vs/platform/keybinding/common/keybinding';
import { IContextKeyService } from 'vs/platform/contextkey/common/contextkey';
import { IViewDescriptorService } from 'vs/workbench/common/views';
import { IOpenerService } from 'vs/platform/opener/common/opener';
import { PANEL_BACKGROUND, SIDE_BAR_BACKGROUND } from 'vs/workbench/common/theme';
import { IMenu, IMenuService, MenuId, MenuItemAction } from 'vs/platform/actions/common/actions';
import { ITerminalProfile, TERMINAL_COMMAND_ID } from 'vs/workbench/contrib/terminal/common/terminal';
import { BaseActionViewItem, SelectActionViewItem } from 'vs/base/browser/ui/actionbar/actionViewItems';
import { ITerminalContributionService } from 'vs/workbench/contrib/terminal/common/terminalExtensionPoints';
import { attachSelectBoxStyler, attachStylerCallback } from 'vs/platform/theme/common/styler';
import { selectBorder } from 'vs/platform/theme/common/colorRegistry';
import { ISelectOptionItem } from 'vs/base/browser/ui/selectBox/selectBox';
import { IActionViewItem } from 'vs/base/browser/ui/actionbar/actionbar';
import { TerminalTabbedView } from 'vs/workbench/contrib/terminal/browser/terminalTabbedView';
import { DropdownMenuActionViewItem } from 'vs/base/browser/ui/dropdown/dropdownActionViewItem';
import { Codicon } from 'vs/base/common/codicons';
import { MenuEntryActionViewItem } from 'vs/platform/actions/browser/menuEntryActionViewItem';
import { ICommandService } from 'vs/platform/commands/common/commands';

export class TerminalViewPane extends ViewPane {
	private _actions: IAction[] | undefined;
	private _fontStyleElement: HTMLElement | undefined;
	private _parentDomElement: HTMLElement | undefined;
	private _tabsViewWrapper: HTMLElement | undefined;
	private _terminalTabbedView?: TerminalTabbedView;
	public get terminalTabbedView(): TerminalTabbedView | undefined { return this._terminalTabbedView; }
	private _terminalsInitialized = false;
	private _bodyDimensions: { width: number, height: number } = { width: 0, height: 0 };
	private _isWelcomeShowing: boolean = false;
	private _tabButtons: DropdownWithPrimaryActionViewItem | undefined;
	private _dropdownMenu: IMenu;
	private _requestedAvailableProfiles: boolean = false;

	constructor(
		options: IViewPaneOptions,
		@IKeybindingService keybindingService: IKeybindingService,
		@IContextKeyService private readonly _contextKeyService: IContextKeyService,
		@IViewDescriptorService viewDescriptorService: IViewDescriptorService,
		@IConfigurationService configurationService: IConfigurationService,
		@IContextMenuService private readonly _contextMenuService: IContextMenuService,
		@IInstantiationService private readonly _instantiationService: IInstantiationService,
		@ITerminalService private readonly _terminalService: ITerminalService,
		@IThemeService themeService: IThemeService,
		@ITelemetryService telemetryService: ITelemetryService,
		@INotificationService private readonly _notificationService: INotificationService,
		@IKeybindingService private readonly _keybindingService: IKeybindingService,
		@IOpenerService openerService: IOpenerService,
		@IMenuService private readonly _menuService: IMenuService,
		@ICommandService private readonly _commandService: ICommandService
	) {
		super(options, keybindingService, _contextMenuService, configurationService, _contextKeyService, viewDescriptorService, _instantiationService, openerService, themeService, telemetryService);
		this._terminalService.onDidRegisterProcessSupport(() => {
			if (this._actions) {
				for (const action of this._actions) {
					action.enabled = true;
				}
			}
			this._onDidChangeViewWelcomeState.fire();
		});
		this._terminalService.onInstanceCreated(() => {
			if (!this._isWelcomeShowing) {
				return;
			}
			this._isWelcomeShowing = true;
			this._onDidChangeViewWelcomeState.fire();
			if (!this._terminalTabbedView && this._parentDomElement) {
				this._createTabsView();
				this.layoutBody(this._parentDomElement.offsetHeight, this._parentDomElement.offsetWidth);
			}
		});

		this._dropdownMenu = this._menuService.createMenu(MenuId.TerminalToolbarContext, this._contextKeyService);

		this._terminalService.onRequestAvailableProfiles(() => {
			if (!this._requestedAvailableProfiles) {
				this._terminalService.getAvailableProfilesAsync().then(profiles => {
					if (this._tabButtons) {
						this._updateTabActionBar(profiles);
					}
				});
				this._requestedAvailableProfiles = true;
			}
		});
		this._terminalService.onProfilesConfigChanged(() => {
			this._terminalService.getAvailableProfilesAsync().then(profiles => {
				if (this._tabButtons) {
					this._updateTabActionBar(profiles);
				}
			});
		});
	}

	public override renderBody(container: HTMLElement): void {
		super.renderBody(container);

		this._parentDomElement = container;
		this._parentDomElement.classList.add('integrated-terminal');
		this._fontStyleElement = document.createElement('style');

		if (!this.shouldShowWelcome()) {
			this._createTabsView();
		}

		this._parentDomElement.appendChild(this._fontStyleElement);

		this._register(this.configurationService.onDidChangeConfiguration(e => {
			if (e.affectsConfiguration('terminal.integrated.fontFamily') || e.affectsConfiguration('editor.fontFamily')) {
				const configHelper = this._terminalService.configHelper;
				if (!configHelper.configFontIsMonospace()) {
					const choices: IPromptChoice[] = [{
						label: nls.localize('terminal.useMonospace', "Use 'monospace'"),
						run: () => this.configurationService.updateValue('terminal.integrated.fontFamily', 'monospace'),
					}];
					this._notificationService.prompt(Severity.Warning, nls.localize('terminal.monospaceOnly', "The terminal only supports monospace fonts. Be sure to restart VS Code if this is a newly installed font."), choices);
				}
			}
		}));

		this._register(this.onDidChangeBodyVisibility(visible => {
			if (visible) {
				const hadTerminals = !!this._terminalService.terminalTabs.length;
				if (this._terminalService.isProcessSupportRegistered) {
					if (this._terminalsInitialized) {
						if (!hadTerminals) {
							this._terminalService.createTerminal();
						}
					} else {
						this._terminalsInitialized = true;
						this._terminalService.initializeTerminals();
					}
				}

				if (hadTerminals) {
					this._terminalService.getActiveTab()?.setVisible(visible);
				} else {
					// TODO@Tyriar - this call seems unnecessary
					this.layoutBody(this._bodyDimensions.height, this._bodyDimensions.width);
				}
				this._terminalService.showPanel(true);
			} else {
				this._terminalService.getActiveTab()?.setVisible(false);
				this._terminalService.terminalInstances.forEach(instance => {
					instance.notifyFindWidgetFocusChanged(false);
				});
			}
		}));
		this.layoutBody(this._parentDomElement.offsetHeight, this._parentDomElement.offsetWidth);
	}

	private _createTabsView(): void {
		if (!this._parentDomElement) {
			return;
		}
		this._tabsViewWrapper = document.createElement('div');
		this._tabsViewWrapper.classList.add('tabs-view-wrapper');
		this._terminalTabbedView = this.instantiationService.createInstance(TerminalTabbedView, this._parentDomElement);
		this._parentDomElement.append(this._tabsViewWrapper);
	}

	protected override layoutBody(height: number, width: number): void {
		super.layoutBody(height, width);

		if (this._terminalTabbedView) {
			this._bodyDimensions.width = width;
			this._bodyDimensions.height = height;

			this._terminalTabbedView.layout(width, height);
		}
	}

	public override getActionViewItem(action: Action): IActionViewItem | undefined {
		if (action.id === TERMINAL_COMMAND_ID.SWITCH_TERMINAL) {
			return this._instantiationService.createInstance(SwitchTerminalActionViewItem, action);
		} else if (action.id === TERMINAL_COMMAND_ID.CREATE_WITH_PROFILE_BUTTON) {
			if (this._tabButtons) {
				this._tabButtons.dispose();
			}
			const actions = this._getInitialTabActionBarArgs();
			this._tabButtons = new DropdownWithPrimaryActionViewItem(actions.primaryAction, actions.dropdownAction, actions.dropdownMenuActions, actions.className, this._contextMenuService, this._keybindingService, this._notificationService, actions.dropdownIcon || 'codicon-chevron-down');
			return this._tabButtons;
		}
		return super.getActionViewItem(action);
	}

	private async _updateTabActionBar(profiles: ITerminalProfile[]): Promise<void> {
		const actions = await this._getTabActionBarArgs(profiles);
		this._tabButtons?.update(actions.dropdownAction, actions.dropdownMenuActions, actions.dropdownIcon);
	}

	private _getTabActionBarArgs(profiles: ITerminalProfile[]): {
		primaryAction: MenuItemAction,
		dropdownAction: MenuItemAction,
		dropdownMenuActions: IAction[],
		className: string,
		dropdownIcon?: string
	} {
		const dropdownActions: IAction[] = [];
		const submenuActions: IAction[] = [];

		for (const p of profiles) {
			dropdownActions.push(new MenuItemAction({ id: TERMINAL_COMMAND_ID.NEW_WITH_PROFILE, title: p.profileName, category: ContextMenuTabsGroup.Profile }, undefined, { arg: p, shouldForwardArgs: true }, this._contextKeyService, this._commandService));
			submenuActions.push(new MenuItemAction({ id: TERMINAL_COMMAND_ID.SPLIT, title: p.profileName, category: ContextMenuTabsGroup.Profile }, undefined, { arg: p, shouldForwardArgs: true }, this._contextKeyService, this._commandService));
		}

		if (dropdownActions.length) {
			dropdownActions.push(new SubmenuAction('split.profile', 'Split...', submenuActions));
			dropdownActions.push(new Separator());
		}

		for (const [, configureActions] of this._dropdownMenu.getActions()) {
			for (const action of configureActions) {
				// make sure the action is a MenuItemAction
				if ('alt' in action) {
					dropdownActions.push(action);
				}
			}
		}

		const primaryAction = this._instantiationService.createInstance(MenuItemAction, { id: TERMINAL_COMMAND_ID.NEW, title: nls.localize('terminal.new', "New Terminal"), icon: Codicon.plus }, undefined, undefined);
		const secondaryAction = this._instantiationService.createInstance(MenuItemAction, { id: 'launch-profile', title: 'Launch Profile...', icon: Codicon.chevronDown }, undefined, undefined);
		return { primaryAction, dropdownAction: secondaryAction, dropdownMenuActions: dropdownActions, className: 'terminal-tab-actions', dropdownIcon: 'codicon-chevron-down' };
	}

	private _getInitialTabActionBarArgs(): {
		primaryAction: MenuItemAction,
		dropdownAction: MenuItemAction,
		dropdownMenuActions: IAction[],
		className: string,
		dropdownIcon?: string
	} {
		const dropdownActions: IAction[] = [];

		for (const [, configureActions] of this._dropdownMenu.getActions()) {
			for (const action of configureActions) {
				if ('alt' in action) {
					dropdownActions.push(action);
				}
			}
		}

		const primaryAction = this._instantiationService.createInstance(MenuItemAction, { id: TERMINAL_COMMAND_ID.NEW, title: nls.localize('terminal.new', "New Terminal"), icon: Codicon.plus }, undefined, undefined);
		const secondaryAction = this._instantiationService.createInstance(MenuItemAction, { id: 'split', title: 'Split', icon: Codicon.chevronDown }, undefined, undefined);
		return { primaryAction, dropdownAction: secondaryAction, dropdownMenuActions: dropdownActions, className: 'terminal.profiles.actions', dropdownIcon: 'codicon-chevron-down' };
	}


	public override focus() {
		if (this._terminalService.connectionState === TerminalConnectionState.Connecting) {
			// If the terminal is waiting to reconnect to remote terminals, then there is no TerminalInstance yet that can
			// be focused. So wait for connection to finish, then focus.
			const activeElement = document.activeElement;
			this._register(this._terminalService.onDidChangeConnectionState(() => {
				// Only focus the terminal if the activeElement has not changed since focus() was called
				// TODO hack
				if (document.activeElement === activeElement) {
					this._focus();
				}
			}));

			return;
		}
		this._focus();
	}

	private _focus() {
		this._terminalService.getActiveInstance()?.focusWhenReady();
	}

	override shouldShowWelcome(): boolean {
		this._isWelcomeShowing = !this._terminalService.isProcessSupportRegistered && this._terminalService.terminalInstances.length === 0;
		return this._isWelcomeShowing;
	}
}

registerThemingParticipant((theme: IColorTheme, collector: ICssStyleCollector) => {
	const panelBackgroundColor = theme.getColor(TERMINAL_BACKGROUND_COLOR) || theme.getColor(PANEL_BACKGROUND);
	collector.addRule(`.monaco-workbench .part.panel .pane-body.integrated-terminal .terminal-outer-container { background-color: ${panelBackgroundColor ? panelBackgroundColor.toString() : ''}; }`);

	const sidebarBackgroundColor = theme.getColor(TERMINAL_BACKGROUND_COLOR) || theme.getColor(SIDE_BAR_BACKGROUND);
	collector.addRule(`.monaco-workbench .part.sidebar .pane-body.integrated-terminal .terminal-outer-container { background-color: ${sidebarBackgroundColor ? sidebarBackgroundColor.toString() : ''}; }`);

	const borderColor = theme.getColor(TERMINAL_BORDER_COLOR);
	if (borderColor) {
		collector.addRule(`.monaco-workbench .pane-body.integrated-terminal .split-view-view:not(:first-child) { border-color: ${borderColor.toString()}; }`);
	}
});


class SwitchTerminalActionViewItem extends SelectActionViewItem {
	constructor(
		action: IAction,
		@ITerminalService private readonly _terminalService: ITerminalService,
		@IThemeService private readonly _themeService: IThemeService,
		@ITerminalContributionService private readonly _contributions: ITerminalContributionService,
		@IContextViewService contextViewService: IContextViewService
	) {
		super(null, action, getTerminalSelectOpenItems(_terminalService, _contributions), _terminalService.activeTabIndex, contextViewService, { ariaLabel: nls.localize('terminals', 'Open Terminals.'), optionsAsChildren: true });
		this._register(_terminalService.onInstancesChanged(() => this._updateItems(), this));
		this._register(_terminalService.onActiveTabChanged(() => this._updateItems(), this));
		this._register(_terminalService.onInstanceTitleChanged(() => this._updateItems(), this));
		this._register(_terminalService.onTabDisposed(() => this._updateItems(), this));
		this._register(_terminalService.onDidChangeConnectionState(() => this._updateItems(), this));
		this._register(_terminalService.onProfilesConfigChanged(() => this._updateItems(), this));
		this._register(attachSelectBoxStyler(this.selectBox, this._themeService));
	}

	override render(container: HTMLElement): void {
		super.render(container);
		container.classList.add('switch-terminal');
		this._register(attachStylerCallback(this._themeService, { selectBorder }, colors => {
			container.style.borderColor = colors.selectBorder ? `${colors.selectBorder}` : '';
		}));
	}

	private _updateItems(): void {
		const options = getTerminalSelectOpenItems(this._terminalService, this._contributions);
		this.setOptions(options, this._terminalService.activeTabIndex);
	}
}

function getTerminalSelectOpenItems(terminalService: ITerminalService, contributions: ITerminalContributionService): ISelectOptionItem[] {
	let items: ISelectOptionItem[];
	if (terminalService.connectionState === TerminalConnectionState.Connected) {
		items = terminalService.getTabLabels().map(label => {
			return { text: label };
		});
	} else {
		items = [{ text: nls.localize('terminalConnectingLabel', "Starting...") }];
	}

	items.push({ text: switchTerminalActionViewItemSeparator, isDisabled: true });

	items.push(...getProfileSelectOptionItems(terminalService));

	for (const contributed of contributions.terminalTypes) {
		items.push({ text: contributed.title });
	}
	items.push({ text: switchTerminalActionViewItemSeparator, isDisabled: true });
	if (terminalService.isProcessSupportRegistered) {
		items.push({ text: selectDefaultProfileTitle });
	}
	items.push({ text: configureTerminalSettingsTitle });
	return items;
}

function getProfileSelectOptionItems(terminalService: ITerminalService): ISelectOptionItem[] {
	const detectedProfiles = terminalService.getAvailableProfiles();
	return detectedProfiles?.map((shell: { profileName: string; }) => ({ text: 'New ' + shell.profileName } as ISelectOptionItem)) || [];
}

export class DropdownWithPrimaryActionViewItem extends BaseActionViewItem {
	private _primaryAction: MenuEntryActionViewItem;
	private _dropdown: DropdownMenuActionViewItem;
	private _container: HTMLElement | null = null;
	constructor(
		primaryAction: MenuItemAction,
		dropdownAction: MenuItemAction,
		dropdownMenuActions: IAction[],
		private readonly _className: string,
		@IContextMenuService private readonly _contextMenuService: IContextMenuService,
		@IKeybindingService private readonly _keybindingService: IKeybindingService,
		@INotificationService private readonly _notificationService: INotificationService,
		dropdownIcon?: string
	) {
		super(null, primaryAction);
		this._primaryAction = new MenuEntryActionViewItem(primaryAction, this._keybindingService, this._notificationService);
		this._dropdown = new DropdownMenuActionViewItem(dropdownAction, dropdownMenuActions, _contextMenuService, { menuAsChild: true, classNames: ['codicon', dropdownIcon || 'codicon-chevron-down'] });
	}

	override render(container: HTMLElement): void {
		this._container = container;
		super.render(this._container);
		this.element = DOM.append(this._container, DOM.$(''));
		this.element.className = this._className;
		this._primaryAction.render(this.element);
		this._dropdown.render(this.element);
		this._stylize();
	}

	private _stylize(): void {
		if (!this.element || !this._dropdown.element || !this._primaryAction.element) {
			return;
		}
		const elementStyle = this.element.style;
		elementStyle.display = 'flex';
		elementStyle.flexDirection = 'row';
		const dropdownStyle = this._dropdown.element.style;
		dropdownStyle.paddingLeft = '0px';
		dropdownStyle.fontSize = '12px';
		dropdownStyle.maxWidth = '6px';
		dropdownStyle.lineHeight = '16px';
		dropdownStyle.marginLeft = '0px';
		const primaryActionStyle = this._primaryAction.element.style;
		primaryActionStyle.marginRight = '0px';
		if (this._primaryAction.element.children[0]) {
			(this._primaryAction.element.children[0] as HTMLElement).style.paddingRight = '0px';
		}
	}

	update(dropdownAction: MenuItemAction, dropdownMenuActions: IAction[], dropdownIcon?: string): void {
		this._dropdown?.dispose();
		this._dropdown = new DropdownMenuActionViewItem(dropdownAction, dropdownMenuActions, this._contextMenuService, { menuAsChild: true, classNames: ['codicon', dropdownIcon || 'codicon-chevron-down'] });
		if (this.element) {
			this._dropdown.render(this.element);
			this._stylize();
		}
	}
}
