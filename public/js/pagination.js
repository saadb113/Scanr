'use strict';

var _pg = {};

function pgSetup(id, data, renderFn, perPage) {
  _pg[id] = { data: data, page: 1, perPage: perPage || 10, render: renderFn };
  _pgDo(id);
}

function pgGo(id, page) {
  if (!_pg[id]) return;
  _pg[id].page = page;
  _pgDo(id);
}

function _pgDo(id) {
  var s = _pg[id];
  if (!s) return;
  var total = s.data.length;
  var pages = Math.ceil(total / s.perPage) || 1;
  s.page = Math.max(1, Math.min(s.page, pages));
  s.render(s.data.slice((s.page - 1) * s.perPage, s.page * s.perPage));
  var bar = document.getElementById(id + '_pg');
  if (bar) bar.innerHTML = _pgHTML(id, s.page, pages, total, s.perPage);
}

function _pgHTML(id, page, pages, total, perPage) {
  if (!total) return '';
  if (pages <= 1) return '<span class="pg-info">' + total + ' row' + (total !== 1 ? 's' : '') + '</span>';
  var from = (page - 1) * perPage + 1;
  var to   = Math.min(page * perPage, total);

  function btn(p, label, dis) {
    return '<button class="pg-btn' + (p === page && !dis ? ' pg-active' : '') +
      '" onclick="pgGo(\'' + id + '\',' + p + ')"' + (dis ? ' disabled' : '') + '>' + label + '</button>';
  }

  var nums = '';
  if (pages <= 7) {
    for (var p = 1; p <= pages; p++) nums += btn(p, p, p === page);
  } else {
    nums += btn(1, 1, page === 1);
    if (page > 3) nums += '<span class="pg-dots">&hellip;</span>';
    var s2 = Math.max(2, page - 1), e2 = Math.min(pages - 1, page + 1);
    for (var q = s2; q <= e2; q++) nums += btn(q, q, q === page);
    if (page < pages - 2) nums += '<span class="pg-dots">&hellip;</span>';
    nums += btn(pages, pages, page === pages);
  }

  return '<span class="pg-info">' + from + '&ndash;' + to + ' of ' + total + '</span>' +
    '<div class="pg-btns">' + btn(page - 1, '&#8249;', page <= 1) + nums + btn(page + 1, '&#8250;', page >= pages) + '</div>';
}
