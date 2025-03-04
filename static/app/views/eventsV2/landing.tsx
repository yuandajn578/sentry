import * as ReactRouter from 'react-router';
import {Params} from 'react-router/lib/Router';
import styled from '@emotion/styled';
import {Location} from 'history';
import isEqual from 'lodash/isEqual';
import pick from 'lodash/pick';
import {stringify} from 'query-string';

import Feature from 'app/components/acl/feature';
import Alert from 'app/components/alert';
import GuideAnchor from 'app/components/assistant/guideAnchor';
import AsyncComponent from 'app/components/asyncComponent';
import Button from 'app/components/button';
import DropdownControl, {DropdownItem} from 'app/components/dropdownControl';
import LightWeightNoProjectMessage from 'app/components/lightWeightNoProjectMessage';
import SearchBar from 'app/components/searchBar';
import SentryDocumentTitle from 'app/components/sentryDocumentTitle';
import Switch from 'app/components/switchButton';
import {t} from 'app/locale';
import ConfigStore from 'app/stores/configStore';
import {PageContent} from 'app/styles/organization';
import space from 'app/styles/space';
import {Organization, SavedQuery, SelectValue} from 'app/types';
import {trackAnalyticsEvent} from 'app/utils/analytics';
import EventView from 'app/utils/discover/eventView';
import {decodeScalar} from 'app/utils/queryString';
import theme from 'app/utils/theme';
import withOrganization from 'app/utils/withOrganization';

import Banner from './banner';
import {DEFAULT_EVENT_VIEW} from './data';
import QueryList from './queryList';
import {
  getPrebuiltQueries,
  isBannerHidden,
  setBannerHidden,
  setRenderPrebuilt,
  shouldRenderPrebuilt,
} from './utils';

const SORT_OPTIONS: SelectValue<string>[] = [
  {label: t('My Queries'), value: 'myqueries'},
  {label: t('Recently Edited'), value: '-dateUpdated'},
  {label: t('Query Name (A-Z)'), value: 'name'},
  {label: t('Date Created (Newest)'), value: '-dateCreated'},
  {label: t('Date Created (Oldest)'), value: 'dateCreated'},
  {label: t('Most Outdated'), value: 'dateUpdated'},
];

type Props = {
  organization: Organization;
  location: Location;
  router: ReactRouter.InjectedRouter;
  params: Params;
} & AsyncComponent['props'];

type State = {
  isBannerHidden: boolean;
  isSmallBanner: boolean;
  savedQueries: SavedQuery[] | null;
  savedQueriesPageLinks: string;
} & AsyncComponent['state'];

class DiscoverLanding extends AsyncComponent<Props, State> {
  mq = window.matchMedia?.(`(max-width: ${theme.breakpoints[1]})`);

  state: State = {
    // AsyncComponent state
    loading: true,
    reloading: false,
    error: false,
    errors: {},

    // local component state
    isBannerHidden: isBannerHidden(),
    renderPrebuilt: shouldRenderPrebuilt(),
    isSmallBanner: this.mq?.matches,
    savedQueries: null,
    savedQueriesPageLinks: '',
  };

  componentDidMount() {
    if (this.mq) {
      this.mq.addListener(this.handleMediaQueryChange);
    }
  }

  componentWillUnmount() {
    if (this.mq) {
      this.mq.removeListener(this.handleMediaQueryChange);
    }
  }

  handleMediaQueryChange = (changed: MediaQueryListEvent) => {
    this.setState({
      isSmallBanner: changed.matches,
    });
  };

  shouldReload = true;

  getSavedQuerySearchQuery(): string {
    const {location} = this.props;

    return decodeScalar(location.query.query, '').trim();
  }

  getActiveSort() {
    const {location} = this.props;

    const urlSort = decodeScalar(location.query.sort, 'myqueries');
    return SORT_OPTIONS.find(item => item.value === urlSort) || SORT_OPTIONS[0];
  }

  getEndpoints(): ReturnType<AsyncComponent['getEndpoints']> {
    const {organization, location} = this.props;

    const views = getPrebuiltQueries(organization);
    const searchQuery = this.getSavedQuerySearchQuery();

    const cursor = decodeScalar(location.query.cursor);
    let perPage = 9;

    const canRenderPrebuilt = this.state
      ? this.state.renderPrebuilt
      : shouldRenderPrebuilt();

    if (!cursor && canRenderPrebuilt) {
      // invariant: we're on the first page

      if (searchQuery && searchQuery.length > 0) {
        const needleSearch = searchQuery.toLowerCase();

        const numOfPrebuiltQueries = views.reduce((sum, view) => {
          const eventView = EventView.fromNewQueryWithLocation(view, location);

          // if a search is performed on the list of queries, we filter
          // on the pre-built queries
          if (eventView.name && eventView.name.toLowerCase().includes(needleSearch)) {
            return sum + 1;
          }

          return sum;
        }, 0);

        perPage = Math.max(1, perPage - numOfPrebuiltQueries);
      } else {
        perPage = Math.max(1, perPage - views.length);
      }
    }

    const queryParams: Location['query'] = {
      cursor,
      query: `version:2 name:"${searchQuery}"`,
      per_page: perPage.toString(),
      sortBy: this.getActiveSort().value,
    };
    if (!cursor) {
      delete queryParams.cursor;
    }

    return [
      [
        'savedQueries',
        `/organizations/${organization.slug}/discover/saved/`,
        {
          query: queryParams,
        },
      ],
    ];
  }

  componentDidUpdate(prevProps: Props) {
    const isHidden = isBannerHidden();
    if (isHidden !== this.state.isBannerHidden) {
      // eslint-disable-next-line react/no-did-update-set-state
      this.setState({
        isBannerHidden: isHidden,
      });
    }
    const PAYLOAD_KEYS = ['sort', 'cursor', 'query'] as const;

    const payloadKeysChanged = !isEqual(
      pick(prevProps.location.query, PAYLOAD_KEYS),
      pick(this.props.location.query, PAYLOAD_KEYS)
    );

    // if any of the query strings relevant for the payload has changed,
    // we re-fetch data
    if (payloadKeysChanged) {
      this.fetchData();
    }
  }

  handleQueryChange = () => {
    this.fetchData({reloading: true});
  };

  handleBannerClick = () => {
    setBannerHidden(true);
    this.setState({isBannerHidden: true});
  };

  handleSearchQuery = (searchQuery: string) => {
    const {location} = this.props;
    ReactRouter.browserHistory.push({
      pathname: location.pathname,
      query: {
        ...location.query,
        cursor: undefined,
        query: String(searchQuery).trim() || undefined,
      },
    });
  };

  handleSortChange = (value: string) => {
    const {location} = this.props;
    trackAnalyticsEvent({
      eventKey: 'discover_v2.change_sort',
      eventName: 'Discoverv2: Sort By Changed',
      organization_id: parseInt(this.props.organization.id, 10),
      sort: value,
    });
    ReactRouter.browserHistory.push({
      pathname: location.pathname,
      query: {
        ...location.query,
        cursor: undefined,
        sort: value,
      },
    });
  };

  renderBanner() {
    const bannerDismissed = this.state.isBannerHidden;

    if (bannerDismissed) {
      return null;
    }
    const {location, organization} = this.props;
    const eventView = EventView.fromNewQueryWithLocation(DEFAULT_EVENT_VIEW, location);
    const to = eventView.getResultsViewUrlTarget(organization.slug);
    const resultsUrl = `${to.pathname}?${stringify(to.query)}`;

    return (
      <Banner
        organization={organization}
        resultsUrl={resultsUrl}
        isSmallBanner={this.state.isSmallBanner}
        onHideBanner={this.handleBannerClick}
      />
    );
  }

  renderActions() {
    const activeSort = this.getActiveSort();
    const {renderPrebuilt, savedQueries} = this.state;

    return (
      <StyledActions>
        <StyledSearchBar
          defaultQuery=""
          query={this.getSavedQuerySearchQuery()}
          placeholder={t('Search saved queries')}
          onSearch={this.handleSearchQuery}
        />
        <PrebuiltSwitch>
          <SwitchLabel>Show Prebuilt</SwitchLabel>
          <Switch
            isActive={renderPrebuilt}
            isDisabled={renderPrebuilt && (savedQueries ?? []).length === 0}
            size="lg"
            toggle={this.togglePrebuilt}
          />
        </PrebuiltSwitch>
        <DropdownControl buttonProps={{prefix: t('Sort By')}} label={activeSort.label}>
          {SORT_OPTIONS.map(({label, value}) => (
            <DropdownItem
              key={value}
              onSelect={this.handleSortChange}
              eventKey={value}
              isActive={value === activeSort.value}
            >
              {label}
            </DropdownItem>
          ))}
        </DropdownControl>
      </StyledActions>
    );
  }

  togglePrebuilt = () => {
    const {renderPrebuilt} = this.state;

    this.setState({renderPrebuilt: !renderPrebuilt}, () => {
      setRenderPrebuilt(!renderPrebuilt);
      this.fetchData({reloading: true});
    });
  };

  onGoLegacyDiscover = () => {
    localStorage.setItem('discover:version', '1');
    const user = ConfigStore.get('user');
    trackAnalyticsEvent({
      eventKey: 'discover_v2.opt_out',
      eventName: 'Discoverv2: Go to discover',
      organization_id: parseInt(this.props.organization.id, 10),
      user_id: parseInt(user.id, 10),
    });
  };

  renderNoAccess() {
    return (
      <PageContent>
        <Alert type="warning">{t("You don't have access to this feature")}</Alert>
      </PageContent>
    );
  }

  renderBody() {
    const {location, organization} = this.props;
    const {savedQueries, savedQueriesPageLinks, renderPrebuilt} = this.state;

    return (
      <QueryList
        pageLinks={savedQueriesPageLinks}
        savedQueries={savedQueries ?? []}
        savedQuerySearchQuery={this.getSavedQuerySearchQuery()}
        renderPrebuilt={renderPrebuilt}
        location={location}
        organization={organization}
        onQueryChange={this.handleQueryChange}
      />
    );
  }

  render() {
    const {location, organization} = this.props;
    const eventView = EventView.fromNewQueryWithLocation(DEFAULT_EVENT_VIEW, location);
    const to = eventView.getResultsViewUrlTarget(organization.slug);

    return (
      <Feature
        organization={organization}
        features={['discover-query']}
        renderDisabled={this.renderNoAccess}
      >
        <SentryDocumentTitle title={t('Discover')} orgSlug={organization.slug}>
          <StyledPageContent>
            <LightWeightNoProjectMessage organization={organization}>
              <PageContent>
                <StyledPageHeader>
                  <GuideAnchor target="discover_landing_header">
                    {t('Discover')}
                  </GuideAnchor>
                  <StyledButton
                    data-test-id="build-new-query"
                    to={to}
                    priority="primary"
                    onClick={() => {
                      trackAnalyticsEvent({
                        eventKey: 'discover_v2.build_new_query',
                        eventName: 'Discoverv2: Build a new Discover Query',
                        organization_id: parseInt(this.props.organization.id, 10),
                      });
                    }}
                  >
                    {t('Build a new query')}
                  </StyledButton>
                </StyledPageHeader>
                {this.renderBanner()}
                {this.renderActions()}
                {this.renderComponent()}
              </PageContent>
            </LightWeightNoProjectMessage>
          </StyledPageContent>
        </SentryDocumentTitle>
      </Feature>
    );
  }
}

const StyledPageContent = styled(PageContent)`
  padding: 0;
`;

const PrebuiltSwitch = styled('div')`
  display: flex;
`;

const SwitchLabel = styled('div')`
  padding-right: 8px;
`;

export const StyledPageHeader = styled('div')`
  display: flex;
  align-items: flex-end;
  font-size: ${p => p.theme.headerFontSize};
  color: ${p => p.theme.textColor};
  justify-content: space-between;
  margin-bottom: ${space(2)};
`;

const StyledSearchBar = styled(SearchBar)`
  flex-grow: 1;
`;

const StyledActions = styled('div')`
  display: grid;
  grid-gap: ${space(2)};
  grid-template-columns: auto max-content min-content;
  align-items: center;
  margin-bottom: ${space(2)};

  @media (max-width: ${p => p.theme.breakpoints[0]}) {
    grid-template-columns: auto;
  }
`;

const StyledButton = styled(Button)`
  white-space: nowrap;
`;

export default withOrganization(DiscoverLanding);
export {DiscoverLanding};
