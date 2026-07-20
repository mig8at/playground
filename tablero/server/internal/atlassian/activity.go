package atlassian

import (
	"context"
	"fmt"
	"net/http"
	"net/url"
	"sync"
)

// recentIssueKeys devuelve las claves de los issues que el usuario tocó
// (asignado o reportado) en los últimos sinceDays días.
func (c *Client) recentIssueKeys(ctx context.Context, sinceDays int) ([]string, error) {
	jql := fmt.Sprintf("(assignee = currentUser() OR reporter = currentUser()) AND updated >= -%dd ORDER BY updated DESC", sinceDays)
	body := map[string]any{"jql": jql, "fields": []string{"key"}, "maxResults": 80}

	var raw struct {
		Issues []struct {
			Key string `json:"key"`
		} `json:"issues"`
	}
	if err := c.do(ctx, http.MethodPost, "/rest/api/3/search/jql", body, &raw); err != nil {
		return nil, err
	}
	keys := make([]string, 0, len(raw.Issues))
	for _, i := range raw.Issues {
		keys = append(keys, i.Key)
	}
	return keys, nil
}

type changelogResp struct {
	Changelog struct {
		Histories []struct {
			Created string `json:"created"`
			Author  struct {
				AccountID string `json:"accountId"`
			} `json:"author"`
		} `json:"histories"`
	} `json:"changelog"`
}

// issueChangelogDays cuenta, por día, los cambios del usuario (accountID) en un issue.
func (c *Client) issueChangelogDays(ctx context.Context, key, accountID string) (map[string]int, error) {
	path := "/rest/api/3/issue/" + url.PathEscape(key) + "?expand=changelog&fields=key"

	var raw changelogResp
	if err := c.do(ctx, http.MethodGet, path, nil, &raw); err != nil {
		return nil, err
	}

	days := map[string]int{}
	for _, h := range raw.Changelog.Histories {
		if h.Author.AccountID != accountID {
			continue
		}
		if len(h.Created) >= 10 {
			days[h.Created[:10]]++
		}
	}
	return days, nil
}

// MyActivityByDay agrupa por día ("YYYY-MM-DD") todos los cambios del usuario en
// sus issues recientes. Usa concurrencia acotada para no ser lento.
func (c *Client) MyActivityByDay(ctx context.Context, accountID string, sinceDays int) (map[string]int, error) {
	keys, err := c.recentIssueKeys(ctx, sinceDays)
	if err != nil {
		return nil, err
	}

	days := map[string]int{}
	var mu sync.Mutex
	var wg sync.WaitGroup
	sem := make(chan struct{}, 6) // máx 6 llamadas en paralelo

	for _, k := range keys {
		wg.Add(1)
		sem <- struct{}{}
		go func(key string) {
			defer wg.Done()
			defer func() { <-sem }()

			part, err := c.issueChangelogDays(ctx, key, accountID)
			if err != nil {
				return
			}
			mu.Lock()
			for d, n := range part {
				days[d] += n
			}
			mu.Unlock()
		}(k)
	}
	wg.Wait()
	return days, nil
}
