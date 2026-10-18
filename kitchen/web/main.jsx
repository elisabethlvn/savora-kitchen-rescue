import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ArrowRight, ArrowLeft, ArrowUpRight, Check, ChevronDown, Download, LoaderCircle, RefreshCw, X } from 'lucide-react';
import tomatoPhoto from '../../design/editorial/assets/tomatoes-dilara-pexels.jpg';
import './styles.css';

const API = '/api/kitchen';
const FIRST_QUESTION = 'Roma tomatoes arrive at 18:30. What depends on them?';
const UNKNOWN_QUESTION = 'Truffle is delayed. What depends on it?';
const asArray = value => Array.isArray(value) ? value : [];
const number = value => typeof value === 'number' && Number.isFinite(value) ? value : null;
const displayNumber = value => number(value) === null ? '-' : new Intl.NumberFormat('en', { maximumFractionDigits: 2 }).format(value);
const kg = value => `${displayNumber(value)} kg`;
const pretty = value => JSON.stringify(value, null, 2);
const kindName = value => String(value || 'record').replaceAll('_', ' ').replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase();

function exportJSON(value, name) {
  const url = URL.createObjectURL(new Blob([pretty(value)], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = `${name}.json`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function Action({ children, onClick, disabled, inverse = false, secondary = false, loading = false, type = 'button', className = '' }) {
  return <button type={type} className={`action ${inverse ? 'inverse' : ''} ${secondary ? 'secondary' : ''} ${className}`} onClick={onClick} disabled={disabled || loading}>
    <span>{children}</span>{loading ? <LoaderCircle size={19} className="spinner" aria-hidden="true" /> : <ArrowRight size={20} aria-hidden="true" />}
  </button>;
}

function EmptyState({ eyebrow, title, children, action, busy = false }) {
  return <section className="empty-state" aria-live="polite" aria-busy={busy}>
    <div className="empty-symbol" aria-hidden="true">{busy ? <LoaderCircle className="spinner" size={26} /> : <span>↗</span>}</div>
    <div><p className="eyebrow">{eyebrow}</p><h2>{title}</h2><div className="empty-copy">{children}</div>{action}</div>
  </section>;
}

function ErrorNotice({ error, onDismiss }) {
  if (!error) return null;
  return <div className="error-notice" role="alert"><div><strong>{error.title || 'This step could not be completed.'}</strong><p>{error.message || String(error)}</p></div>{onDismiss && <button className="icon-button" aria-label="Dismiss message" onClick={onDismiss}><X size={20} /></button>}</div>;
}

function AgentLabel({ agent, status }) {
  const mode = agent?.mode;
  return <div className="agent-explanation">
    <span className={`status-dot ${status?.database === 'connected' ? 'connected' : ''}`} aria-hidden="true" />
    <span>{!status ? 'Checking local connection' : status.database !== 'connected' ? 'Local graph unavailable' : mode === 'gemini' ? `Gemini agent${agent?.model ? ` · ${agent.model}` : ''}` : mode === 'guided' ? 'Guided mode · deterministic tool sequence' : status.modelStatus === 'configured-unverified' || status.modelConfigured ? 'Gemini configured · no model run confirmed' : 'Guided mode available · awaiting a result'}</span>
    {status?.database === 'connected' && <span className="connection-detail">FalkorDBLite · local MCP</span>}
  </div>;
}

function Header({ view, onNavigate, status }) {
  return <header className="topbar">
    <a className="wordmark" href="#main" onClick={() => onNavigate('investigate')} aria-label="Savora Kitchen Rescue home">savora<span aria-hidden="true">.</span></a>
    <span className="product-name">Kitchen rescue</span>
    <nav aria-label="Main navigation">
      {[['investigate', 'Investigate'], ['prep', 'Prep board'], ['decisions', 'Decisions']].map(([id, label]) => <button key={id} className={(view === id || id === 'investigate' && view === 'recovery') ? 'active' : ''} onClick={() => onNavigate(id)} aria-current={view === id || id === 'investigate' && view === 'recovery' ? 'page' : undefined}>{label}</button>)}
    </nav>
    <span className="kitchen-mark" title={status?.dataset || 'Local fictional kitchen'}>BK</span>
  </header>;
}

function EditorialHero({ result }) {
  const unknown = result?.status === 'unknown';
  const services = number(result?.metrics?.services);
  const connected = result && !unknown && services > 0;
  const count = services === 1 ? 'One dinner connected.' : services === 2 ? 'Two dinners connected.' : `${services} services connected.`;
  const ingredientRecord = asArray(result?.graph?.nodes).find(node => node.depth === 0);
  const fromTime = ingredientRecord?.originalArrivalTime;
  const toTime = ingredientRecord?.arrivalTime;
  const delay = number(ingredientRecord?.arrivalDelayMinutes);
  const delayLabel = delay === null ? 'Planned → updated arrival' : delay > 0 ? `${Math.floor(delay / 60) ? `${Math.floor(delay / 60)}h ` : ''}${delay % 60 ? `${delay % 60}m ` : ''}delivery delay` : delay === 0 ? 'No recorded arrival delay' : 'Recorded arrival moved earlier';
  const headline = result && !fromTime && !toTime ? 'One ingredient.' : 'One late delivery.';
  return <section className="editorial-hero">
    <div className="hero-title"><p className="eyebrow">Kitchen investigation / delivery delay</p>
      <h1>{unknown ? <>There’s a gap<br />in this kitchen.</> : <>{headline}<br />{connected ? count : result?.depth === 4 ? 'Follow what’s recorded.' : 'How far does it reach?'}</>}</h1>
    </div>
    {unknown ? <div className="resolution-note"><p className="eyebrow">Resolution result</p><p className="resolution-result">Not modeled.</p><p>No supported starting record.<br />That is not an all-clear.</p></div> : <div className="hero-context">
      <div className="arrival-note"><p className="eyebrow">{fromTime && toTime ? 'Recorded arrival' : 'Kitchen context'}</p><span className="old-time">{fromTime || '-'}</span><span className="new-time">{toTime || '-'}</span><p>{fromTime && toTime ? delayLabel : !result ? 'Awaiting the ingredient record' : 'No delivery time returned'}</p><small>Fictional Bandung kitchen</small></div>
      <figure className="context-photo"><img src={tomatoPhoto} alt="Heirloom tomatoes on a wooden table; illustrative kitchen photography" /><figcaption>Kitchen study · <a href="https://www.pexels.com/photo/fresh-heirloom-tomatoes-on-rustic-wooden-table-29081091/" target="_blank" rel="noreferrer">Dilara / Pexels <ArrowUpRight size={10} /></a></figcaption></figure>
    </div>}
  </section>;
}

function QuestionBar({ question, setQuestion, depth, investigate, busy, connected, currentQuestion }) {
  return <form className="question-bar" onSubmit={event => { event.preventDefault(); investigate(question, depth); }}>
    <div className="question-field"><label htmlFor="question" className="eyebrow">Ask Savora</label><div className="question-input-row"><input id="question" name="question" value={question} onChange={event => setQuestion(event.target.value)} maxLength={500} autoComplete="off" disabled={busy} /><button type="submit" className="investigate-submit" aria-label="Investigate this question" disabled={!connected || busy || !question.trim()}>{busy ? <LoaderCircle className="spinner" size={22} /> : <ArrowRight size={23} />}</button></div>
      <div className="question-help"><span>{currentQuestion && question !== currentQuestion ? 'Edited question · press Enter to investigate' : 'Press Enter to trace the graph'}</span><button type="button" disabled={!connected || busy} onClick={() => investigate(UNKNOWN_QUESTION, depth)}>Try an unknown ingredient <ArrowUpRight size={12} /></button></div>
    </div>
    <fieldset className="depth-control"><legend>Connection depth</legend><div>{[1, 2, 3, 4].map(value => <button type="button" key={value} aria-pressed={depth === value} className={depth === value ? 'selected' : ''} disabled={!connected || busy} onClick={() => investigate(question, value)} aria-label={`Investigate ${value} ${value === 1 ? 'hop' : 'hops'}`}>{value}</button>)}</div></fieldset>
  </form>;
}

function splitLabel(value, max = 18) {
  const words = String(value).split(' ');
  const rows = [''];
  for (const word of words) {
    if (rows[rows.length - 1] && `${rows[rows.length - 1]} ${word}`.length > max) rows.push(word);
    else rows[rows.length - 1] += (rows[rows.length - 1] ? ' ' : '') + word;
  }
  return rows;
}

function graphPositions(nodes, edges) {
  const groups = new Map();
  nodes.forEach(node => { const depth = Number(node.depth) || 0; if (!groups.has(depth)) groups.set(depth, []); groups.get(depth).push(node); });
  const positions = new Map();
  [...groups.entries()].sort(([a], [b]) => a - b).forEach(([depth, group]) => {
    const parentY = node => {
      const edge = edges.find(item => item.target === node.id);
      return edge ? positions.get(edge.source)?.y ?? 165 : 165;
    };
    group.sort((a, b) => parentY(a) - parentY(b));
    group.forEach((node, index) => positions.set(node.id, { x: 30 + depth * 211, y: group.length === 1 ? 165 : 100 + index * Math.min(165, 330 / Math.max(1, group.length - 1)) }));
  });
  return positions;
}

function Graph({ result, onExplore }) {
  const [selected, setSelected] = useState(null);
  const nodes = asArray(result.graph?.nodes);
  const edges = asArray(result.graph?.edges);
  const paths = asArray(result.paths);
  const positions = graphPositions(nodes, edges);
  const selectedPaths = selected ? paths.filter(path => asArray(path.nodeIds).includes(selected)) : [];
  const highlighted = new Set(selectedPaths.flatMap(path => asArray(path.nodeIds)));
  if (selected) highlighted.add(selected);
  const selectedNode = nodes.find(node => node.id === selected);
  const shownPaths = selected ? selectedPaths : paths;
  const maxDepth = Math.max(0, ...nodes.map(node => Number(node.depth) || 0));
  const activeEdge = edge => !selected || selectedPaths.some(path => {
    const ids = asArray(path.nodeIds);
    return ids.some((id, i) => id === edge.source && ids[i + 1] === edge.target);
  });
  useEffect(() => setSelected(null), [result.runId, result.depth]);
  return <section className="dependency-section" aria-labelledby="graph-title">
    <div className="section-heading"><div><p className="eyebrow">The dependency map</p><h2 id="graph-title">Follow the ingredient.</h2></div><span>{result.depth} {result.depth === 1 ? 'hop' : 'hops'} / {displayNumber(result.metrics?.nodes)} records returned</span></div>
    <div className="graph-scroll" tabIndex={0} aria-label="Dependency graph, horizontally scrollable on small screens">
      <div className="graph-stage">
        <svg className="dependency-graph" viewBox="0 0 1035 390" role="group" aria-label={`Recorded ingredient dependency graph, ${nodes.length} nodes. Select a node to inspect its supporting paths.`}>
          {['Ingredient', 'Shared base', 'Preparation', 'Dish', 'Service'].map((name, index) => <text className="column-label" key={name} x={12 + index * 211} y="24">{name}</text>)}
          <g aria-hidden="true">{edges.map((edge, index) => {
            const source = positions.get(edge.source); const target = positions.get(edge.target);
            if (!source || !target) return null;
            const mid = source.x + (target.x - source.x) / 2;
            return <path key={`${edge.source}-${edge.target}-${index}`} className={`graph-edge ${activeEdge(edge) ? '' : 'muted'}`} d={`M${source.x + 8} ${source.y} H${mid - 20} Q${mid} ${source.y} ${mid} ${(source.y + target.y) / 2} V${target.y + (source.y > target.y ? 18 : source.y < target.y ? -18 : 0)} Q${mid} ${target.y} ${mid + 20} ${target.y} H${target.x - 8}`} />;
          })}</g>
          {nodes.map(node => {
            const point = positions.get(node.id); const rows = splitLabel(node.label || node.name || node.id);
            const meta = node.serviceTime ? `${node.serviceTime}${number(node.portions) !== null ? ` · ${node.portions} portions` : ''}` : number(node.requiredKg) !== null ? `${node.requiredKg} kg required` : number(node.durationMinutes) !== null ? `${node.durationMinutes} min preparation` : kindName(node.kind);
            return <g key={node.id} className={`graph-node ${selected === node.id ? 'selected' : ''} ${selected && !highlighted.has(node.id) ? 'muted' : ''}`} role="button" tabIndex="0" aria-pressed={selected === node.id} aria-label={`${node.label || node.name}, ${kindName(node.kind)}, hop ${node.depth}. Show supporting paths.`} onClick={() => setSelected(selected === node.id ? null : node.id)} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setSelected(selected === node.id ? null : node.id); } }}>
              <title>{node.label || node.name} · {kindName(node.kind)} · hop {node.depth}</title>
              <rect className="node-hit" x={point.x - 14} y={point.y - 19} width="171" height={rows.length * 23 + 74} rx="3" />
              <circle cx={point.x} cy={point.y} r={node.depth === 0 ? 10 : 7} className={node.depth === 0 ? 'root-node' : ''} />
              <text className="node-label" x={point.x - 14} y={point.y + 36}>{rows.map((row, index) => <tspan key={index} x={point.x - 14} dy={index === 0 ? 0 : 23}>{row}</tspan>)}</text>
              <text className="node-meta" x={point.x - 14} y={point.y + 44 + rows.length * 23}>{meta}</text>
              {kindName(node.kind).includes('service') && <line className="service-rule" x1={point.x - 14} x2={point.x + 120} y1={point.y + 64 + rows.length * 23} y2={point.y + 64 + rows.length * 23} />}
            </g>;
          })}
        </svg>
        {result.depth < 4 && <div className={`beyond-search depth-${maxDepth}`}><p className="eyebrow">Beyond this search</p><h3>{maxDepth < 3 ? <>Downstream impact<br />not evaluated.</> : <>Service commitments<br />not evaluated.</>}</h3><p>A limited traversal is not an all-clear.<br />Explore four hops to inspect the modeled service paths.</p><button className="text-action" onClick={onExplore}>Explore 4 hops <ArrowRight size={18} /></button></div>}
      </div>
    </div>
    <div className="graph-caption"><span>Each line is a recorded dependency. Select a node to follow its evidence.</span>{selected && <button className="text-action" onClick={() => setSelected(null)}>Clear selection <X size={14} /></button>}</div>
    <details className="path-details" open={selected ? true : undefined}><summary>{selectedNode ? `Paths through ${selectedNode.label || selectedNode.name}` : 'Inspect the returned paths'}<span>{shownPaths.length} {shownPaths.length === 1 ? 'path' : 'paths'}<ChevronDown size={16} /></span></summary><ol>{shownPaths.map((path, index) => <li key={index}><span>{path.hops} {path.hops === 1 ? 'hop' : 'hops'}</span><p>{asArray(path.labels).join(' → ') || asArray(path.nodeIds).join(' → ')}</p></li>)}</ol>{shownPaths.length === 0 && <p className="muted-copy">No supporting path was returned for this selection.</p>}</details>
  </section>;
}

function Finding({ result, onRecovery, onExplore, busy }) {
  const serviceCount = number(result.metrics?.services) ?? 0;
  const limited = result.depth < 4;
  const count = limited ? Math.max(0, (number(result.metrics?.nodes) ?? 1) - 1) : serviceCount;
  return <aside className="finding-panel"><p className="eyebrow">What the path reveals</p><div className="finding-number">{String(count).padStart(2, '0')}</div><h3>{limited ? `${count === 1 ? 'record' : 'records'} connected` : `${serviceCount === 1 ? 'service' : 'services'} connected`}</h3><div className="finding-copy">
    {!limited && number(result.metrics?.portions) !== null && <p>{displayNumber(result.metrics.portions)} portions in the returned service paths.</p>}
    <p>{result.answer}</p>
    {limited && <p className="limited-note">Service impact is not fully evaluated at this depth.</p>}
  </div><div className="finding-action">{limited ? <Action inverse onClick={onExplore}>Explore 4 hops</Action> : <Action inverse onClick={onRecovery} loading={busy} disabled={!result.ingredient?.id || serviceCount === 0}>Review recovery</Action>}<small>{limited ? 'A shallow answer is not an all-clear.' : 'Approval required before changes'}</small></div></aside>;
}

function UnknownResult({ result, onReset }) {
  return <section className="unknown-result"><div className="unknown-marker"><p className="eyebrow">No supported path</p><div><span aria-hidden="true">?</span><p>Unresolved<br />ingredient</p><i aria-hidden="true" /></div></div><div className="unknown-explanation"><h2>Unknown does not<br />mean unaffected.</h2><p>{result.answer}</p><p>No ingredient record means no supported recipe traversal or recovery proposal. Savora will not invent a connection.</p><Action onClick={onReset}>Return to Roma tomatoes</Action></div></section>;
}

function ToolTrace({ trace, agent, status, title = 'Evidence, not guesswork.', data, name = 'savora-investigation' }) {
  const tools = asArray(trace);
  return <section className="evidence-section" aria-labelledby={`${name}-evidence`}><div className="evidence-heading"><h2 id={`${name}-evidence`}>{title}</h2><div><span>Actual local MCP calls · measured durations</span>{data && <button className="icon-button" aria-label="Export evidence as JSON" title="Export evidence as JSON" onClick={() => exportJSON(data, name)}><Download size={18} /></button>}</div></div>
    <div className="tool-list">{tools.map((entry, index) => <details className="tool-entry" key={`${entry.tool}-${index}`}><summary><span className="tool-index">{String(index + 1).padStart(2, '0')}</span><span className="tool-name">{entry.tool}</span><span className="tool-result">{number(entry.rowCount) !== null ? `${displayNumber(entry.rowCount)} ${entry.rowCount === 1 ? 'row' : 'rows'}` : 'Row count unavailable'}</span><span className="tool-time">{number(entry.durationMs) !== null ? `${displayNumber(entry.durationMs)} ms` : 'Timing unavailable'}</span><span className="tool-source">{entry.source === 'mcp' ? 'MCP' : entry.source || 'Source not reported'}</span><ChevronDown size={16} /></summary><div className="tool-detail"><div><p className="eyebrow">Tool arguments</p><pre>{pretty(entry.args ?? {})}</pre></div><div><p className="eyebrow">Executed Cypher</p><pre>{entry.cypher || 'No Cypher was reported for this call.'}</pre></div>{entry.error && <p>{String(entry.error)}</p>}</div></details>)}</div>
    {!tools.length && <p className="muted-copy">No tool calls were returned for this operation.</p>}
    <div className="evidence-footer"><AgentLabel agent={agent} status={status} /><p>{agent?.reason || (agent?.mode === 'gemini' ? 'Model-assisted tool selection; facts come from graph results.' : 'The guided workflow calls a fixed set of parameterized graph tools. It does not claim AI-selected reasoning.')}</p></div>
  </section>;
}

function ReservationList({ reservations }) {
  const records = asArray(reservations);
  if (!records.length) return <p className="muted-copy">No protected reservations were returned.</p>;
  return <ul className="reservation-list">{records.map((entry, index) => <li key={entry.id || index}><span>{entry.name || entry.orderName || entry.serviceName || entry.label || entry.ingredientName || 'Protected reservation'}</span><strong>{kg(entry.quantityKg ?? entry.reservedKg ?? entry.kg ?? entry.amountKg)}</strong>{entry.ingredientName && <small>{entry.ingredientName}{entry.purpose ? ` · ${entry.purpose}` : ''}</small>}</li>)}</ul>;
}

function PrepTargets({ targets, compact = false }) {
  return <div className={`prep-targets ${compact ? 'compact' : ''}`}>{asArray(targets).map((target, index) => <div className="prep-target" key={`${target.name}-${index}`}><time>{target.time || 'Not supplied'}</time><span className="timeline-dot" aria-hidden="true" /><div><h3>{target.name}</h3><p>{target.serviceTime ? `Serve at ${target.serviceTime}` : 'Shared preparation target'}</p></div><span className="prep-buffer">{number(target.bufferMinutes) !== null ? `${target.bufferMinutes}-minute buffer` : 'Ready target'}</span></div>)}</div>;
}

function StockOption({ option, selected }) {
  const reasons = [];
  if (number(option.shortfallKg) > 0) reasons.push(`${kg(option.shortfallKg)} short of the required free stock.`);
  if (option.quantityBasisValid === false) reasons.push(`The declared recipe serves ${displayNumber(option.plannedPortions)} portions; the graph requires ${displayNumber(option.currentPortions)}.`);
  if (option.timingFeasible === false) reasons.push('Preparation timing or dependency completeness does not meet the modeled service constraints.');
  return <article className={`stock-option ${selected ? 'proposed' : ''}`}><p className="eyebrow">{selected ? 'Proposed / fits the returned constraints' : option.feasible ? 'Alternative / checks passed' : 'Not selected / constraints not met'}</p><h2>{option.name}</h2><div className="stock-total"><span>{kg(option.stockKg)}</span><p>on the shelf</p></div><dl><div><dt>Reserved for other commitments</dt><dd>− {kg(option.reservedKg)}</dd></div><div><dt>Available for this recovery</dt><dd>{kg(option.availableKg)}</dd></div><div><dt>Required by this recipe alternative</dt><dd>{kg(option.requiredKg)}</dd></div></dl><div className="stock-verdict">{selected ? <><strong>{kg(number(option.availableKg) !== null && number(option.requiredKg) !== null ? option.availableKg - option.requiredKg : null)} left free</strong><p>Use a declared recipe alternative. No new supplier purchase.</p></> : option.feasible ? <><strong>Meets the returned recovery constraints.</strong><p>Only the proposed option will be reserved on approval.</p></> : <><strong>{reasons.length ? reasons.join(' ') : 'This option did not pass the returned recovery checks.'}</strong><p>Existing reservations are protected, not borrowed.</p></>}</div></article>;
}

function RecoveryView({ proposal, busy, onRetry, onBack, confirmed, setConfirmed, onApprove, status }) {
  if (!proposal) return <><button className="back-link" onClick={onBack}><ArrowLeft size={16} />Connected impact</button><EmptyState eyebrow={busy ? 'Review in progress' : 'Recovery not loaded'} title={busy ? 'Check the alternatives.' : 'A fresh proposal is needed.'} busy={busy} action={!busy && <Action onClick={onRetry} disabled={status?.database !== 'connected'}>Review recovery again</Action>}><p>{busy ? 'Inspecting graph-connected stock, protected reservations, and declared recipe alternatives. No approval has been made.' : 'No stale proposal will be submitted. Run the stock and reservation checks again before approving.'}</p></EmptyState></>;
  const options = [...asArray(proposal.options)].sort((a, b) => Number(a.ingredientId === proposal.selected?.ingredientId) - Number(b.ingredientId === proposal.selected?.ingredientId));
  const selected = proposal.selected;
  return <><button className="back-link" onClick={onBack}><ArrowLeft size={16} />Connected impact</button><section className="recovery-hero"><div><p className="eyebrow">Recovery / {proposal.eligible && selected ? 'awaiting your approval' : 'no eligible recovery'}</p><h1>Save tonight.<br />Keep tomorrow.</h1></div><div><p>An alternative only works if it<br />protects the other commitments.</p><small>Proposal based on graph revision {proposal.revision ?? 'not reported'}</small></div></section>
    <section className="stock-options" aria-label="Recipe alternatives and stock constraints">{options.map((option, index) => <StockOption key={option.ingredientId || index} option={option} selected={option.ingredientId === selected?.ingredientId} />)}</section>
    {!options.length && <p className="muted-copy">No graph-backed recipe alternatives were returned.</p>}
    <div className="recovery-context"><div><p className="eyebrow">Preserve these commitments</p><ReservationList reservations={proposal.protectedReservations} /></div><div><p className="eyebrow">Recipe and timing assumptions</p><p><strong>{proposal.scenarioTime ? `Simulation clock: ${proposal.scenarioTime}, from the kitchen graph.` : 'Simulation clock was not returned.'}</strong> These are declared chef-approved alternatives in a fictional kitchen. Yields and preparation targets are synthetic assumptions, not food-safety or allergen advice.</p></div></div>
    <section className="schedule-review"><div className="section-heading"><div><p className="eyebrow">Before you approve</p><h2>Review every preparation target.</h2></div><span>Returned by the recovery simulation</span></div><PrepTargets targets={proposal.prepTargets} compact /></section>
    <section className="approval-layout"><div><h2>Review the change.</h2><div className="change-table-wrap"><table className="change-table"><thead><tr><th>Record</th><th>Current check</th><th>After approval</th></tr></thead><tbody>{selected && <><tr><th>{selected.name} reservation</th><td>{kg(options.find(option => option.ingredientId === selected.ingredientId)?.availableKg)} available</td><td>{kg(selected.requiredKg)} reserved</td></tr><tr><th>Recovery alternative</th><td>Proposed alternative</td><td>{selected.name} saved in receipt</td></tr></>}<tr><th>Preparation tasks</th><td>Proposed targets above</td><td>{asArray(proposal.prepTargets).length} targets saved together</td></tr><tr><th>Protected reservations</th><td>{asArray(proposal.protectedReservations).length} returned by the graph</td><td>Preserved, not consumed</td></tr></tbody></table></div></div><div className="approval-box"><p className="eyebrow">Human approval</p><p>Save the chosen alternative, stock reservation and preparation tasks together in the local graph. The recipe graph is unchanged. No order, payment, or external message.</p><label className="approval-check"><input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} disabled={busy || !proposal.eligible || !selected} /><span>I have reviewed the stock, protected reservations and preparation targets.</span></label><Action onClick={onApprove} loading={busy} disabled={!confirmed || !proposal.eligible || !selected}>Approve recovery</Action><small>Stock and graph revision are checked again when you approve.</small></div></section>
    <ToolTrace trace={proposal.trace} agent={proposal.agent} status={status} title="Why this recovery?" data={proposal} name="savora-recovery" />
  </>;
}

function PrepBoard({ state, receipt, loading, error, onReload, onInvestigate }) {
  const plans = asArray(state?.approvedPlans);
  const plan = receipt || plans[plans.length - 1];
  if (loading && !plan) return <EmptyState eyebrow="Reading the saved graph" title="Loading the prep board." busy><p>Fetching approved reservations and preparation targets from the local database.</p></EmptyState>;
  if (error && !plan) return <EmptyState eyebrow="Prep board unavailable" title="Saved work could not be read." action={<Action onClick={onReload}>Try again</Action>}><p>{error}</p></EmptyState>;
  if (!plan) return <EmptyState eyebrow="Prep board / no approved recovery" title="A plan starts with its evidence." action={<Action onClick={onInvestigate}>Investigate a delivery</Action>}><p>No approved recovery was returned by the graph. Review a proposal, then explicitly approve it to save preparation tasks here.</p></EmptyState>;
  const selected = plan.selected;
  return <><section className="recovery-hero approved-hero"><div><p className="eyebrow">Saved recovery / graph revision {plan.revision ?? state?.revision ?? 'not reported'}</p><h1>A plan, saved.<br />A trail to follow.</h1></div><div><p>Internal records updated.<br />No purchase or payment made.</p><button className="text-action" onClick={() => exportJSON(plan, 'savora-approved-recovery')}>Export approval receipt <Download size={16} /></button></div></section><div className="outcome-strip"><div><strong>{kg(selected?.requiredKg)}</strong><p>{selected?.name || 'Recovery ingredient'} reserved</p></div><div><strong>{kg(selected?.remainingKg)}</strong><p>Remaining free stock, after this approval</p></div><div><strong>{asArray(plan.prepTargets).length}</strong><p>Preparation targets saved</p></div></div><section className="saved-schedule"><div className="section-heading"><div><p className="eyebrow">Preparation / saved schedule</p><h2>One base. Connected services.</h2></div><span>Fictional recovery targets, not a live kitchen forecast</span></div><PrepTargets targets={plan.prepTargets} /></section><section className="receipt-note"><h2>Keep the decision,<br />not just the answer.</h2><div><p>The approved proposal and audit records are saved in the local graph. Food quantities, timing and recipe alternatives remain fictional.</p><dl><div><dt>Proposal</dt><dd>{plan.proposalId || plan.id || 'Not reported'}</dd></div><div><dt>Revision</dt><dd>{plan.revision ?? state?.revision ?? 'Not reported'}</dd></div></dl></div></section>{error && <ErrorNotice error={{ title: 'Approval returned successfully; refresh could not finish.', message: error }} />}</>;
}

function Decisions({ state, loading, error, onReload }) {
  const audit = asArray(state?.audit);
  return <><section className="decisions-hero"><p className="eyebrow">Decision record / local graph</p><h1>The reasoning.<br />And the record.</h1><p>Saved graph events, not generated explanations presented as an audit.</p></section>{loading ? <EmptyState eyebrow="Loading audit" title="Reading saved decisions." busy><p>The local database is the source of truth.</p></EmptyState> : error ? <EmptyState eyebrow="Audit unavailable" title="The record could not be read." action={<Action onClick={onReload}>Try again</Action>}><p>{error}</p></EmptyState> : <><div className="section-heading"><h2>{audit.length} saved {audit.length === 1 ? 'event' : 'events'}</h2><button className="text-action" disabled={!state} onClick={() => exportJSON(state, 'savora-kitchen-audit')}>Export graph state <Download size={16} /></button></div>{audit.length ? <div className="audit-list">{audit.map((entry, index) => <details key={entry.id || index}><summary><span className="tool-index">{String(index + 1).padStart(2, '0')}</span><div><h3>{entry.action || entry.type || entry.event || 'Recorded graph event'}</h3><p>{entry.createdAt || entry.timestamp || entry.at || entry.proposalId || 'Open to inspect the exact saved record'}</p></div><ChevronDown size={18} /></summary><pre>{pretty(entry)}</pre></details>)}</div> : <p className="no-audit">No audit events were returned. An approved recovery will create a saved decision record.</p>}</>}</>;
}

function App() {
  const [view, setView] = useState('investigate');
  const [status, setStatus] = useState(null);
  const [question, setQuestion] = useState(FIRST_QUESTION);
  const [depth, setDepth] = useState(4);
  const [result, setResult] = useState(null);
  const [currentQuestion, setCurrentQuestion] = useState('');
  const [proposal, setProposal] = useState(null);
  const [receipt, setReceipt] = useState(null);
  const [state, setState] = useState(null);
  const [stateLoading, setStateLoading] = useState(true);
  const [stateError, setStateError] = useState('');
  const [busy, setBusy] = useState('connect');
  const [error, setError] = useState(null);
  const [confirmed, setConfirmed] = useState(false);
  const tokenRef = useRef(null);
  const requestRef = useRef(0);
  const mounted = useRef(true);
  const mainRef = useRef(null);

  async function request(path, body) {
    let response;
    try {
      response = await fetch(`${API}${path}`, { method: body === undefined ? 'GET' : 'POST', credentials: 'same-origin', headers: body === undefined ? { Accept: 'application/json' } : { Accept: 'application/json', 'Content-Type': 'application/json', 'X-Savora-Token': tokenRef.current || '' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    } catch { throw new Error('The local API could not be reached. Start the Kitchen Rescue server, then reconnect.'); }
    let data;
    try { data = await response.json(); } catch { throw new Error('The server did not return a valid JSON response. Check that the Kitchen Rescue API is running on port 4319.'); }
    if (!response.ok) {
      const message = typeof data.error === 'string' ? data.error : data.error?.message || data.message || 'The server could not complete this request.';
      const problem = new Error(message); problem.status = response.status; problem.code = data.code || data.error?.code; throw problem;
    }
    return data;
  }

  async function refreshState() {
    setStateLoading(true); setStateError('');
    try { const next = await request('/state'); if (mounted.current) setState(next); }
    catch (problem) { if (mounted.current) { setState(null); setStateError(problem.message); } }
    finally { if (mounted.current) setStateLoading(false); }
  }

  async function investigate(nextQuestion = question, nextDepth = depth) {
    if (!nextQuestion.trim()) return;
    const requestId = ++requestRef.current;
    setQuestion(nextQuestion); setDepth(nextDepth); setView('investigate'); setBusy('investigate'); setError(null); setResult(null); setProposal(null); setConfirmed(false);
    try {
      const next = await request('/investigate', { question: nextQuestion.trim(), depth: nextDepth });
      if (mounted.current && requestId === requestRef.current) { setResult(next); setCurrentQuestion(nextQuestion); }
    } catch (problem) {
      if (mounted.current && requestId === requestRef.current) setError({ title: 'Investigation did not complete.', message: problem.message });
      if (problem.status === 403) await refreshToken();
    } finally { if (mounted.current && requestId === requestRef.current) setBusy(''); }
  }

  async function refreshToken() {
    try { const next = await request('/status'); tokenRef.current = next.csrfToken; setStatus(next); } catch { /* The original request failure remains visible. */ }
  }

  async function connect() {
    setBusy('connect'); setError(null); setResult(null); setProposal(null); setStatus(null);
    try {
      const next = await request('/status');
      if (!mounted.current) return;
      setStatus(next); tokenRef.current = next.csrfToken;
      if (next.database !== 'connected') { setBusy(''); setStateLoading(false); setStateError('The local graph is unavailable.'); return; }
      void refreshState();
      await investigate(question, depth);
    } catch (problem) { if (mounted.current) { setError({ title: 'Local graph unavailable.', message: problem.message }); setBusy(''); setStateLoading(false); setStateError(problem.message); } }
  }

  useEffect(() => { mounted.current = true; void connect(); return () => { mounted.current = false; requestRef.current++; }; }, []);

  function navigate(next) {
    setView(next);
    if (next === 'prep' || next === 'decisions') void refreshState();
    requestAnimationFrame(() => { mainRef.current?.focus({ preventScroll: true }); window.scrollTo({ top: 0, behavior: 'instant' }); });
  }

  async function reviewRecovery() {
    if (!result?.ingredient?.id) return;
    setView('recovery'); setProposal(null); setBusy('recovery'); setError(null); setConfirmed(false);
    window.scrollTo({ top: 0, behavior: 'instant' });
    try { const next = await request('/recovery', { ingredientId: result.ingredient.id }); if (mounted.current) setProposal(next); }
    catch (problem) { if (mounted.current) setError({ title: 'Recovery review did not complete.', message: problem.message }); if (problem.status === 403) await refreshToken(); }
    finally { if (mounted.current) setBusy(''); }
  }

  async function approve() {
    if (!confirmed || !proposal?.eligible || !proposal.selected || busy) return;
    setBusy('approve'); setError(null);
    try {
      const next = await request('/approve', { proposalId: proposal.id, expectedRevision: proposal.revision });
      if (next.status !== 'approved') throw new Error('The server did not confirm approval. No successful update is being assumed.');
      setReceipt(next); setProposal(null); setConfirmed(false); setStatus(previous => ({ ...previous, revision: next.revision })); setView('prep');
      window.scrollTo({ top: 0, behavior: 'instant' });
      await refreshState();
    } catch (problem) { setProposal(null); setConfirmed(false); setError({ title: problem.status === 409 ? 'The graph changed. Review a fresh proposal.' : 'Approval was not confirmed.', message: problem.message }); if (problem.status === 403) await refreshToken(); }
    finally { setBusy(''); }
  }

  const connected = status?.database === 'connected';
  const mode = (view === 'recovery' ? proposal?.agent : result?.agent) || undefined;
  return <div className="app-shell"><a className="skip-link" href="#main">Skip to workspace</a><Header view={view} onNavigate={navigate} status={status} /><main id="main" ref={mainRef} tabIndex={-1}>
    {view === 'investigate' && <><EditorialHero result={result} /><QuestionBar question={question} setQuestion={setQuestion} depth={depth} investigate={investigate} busy={Boolean(busy)} connected={connected} currentQuestion={currentQuestion} /><div className="workspace-status"><AgentLabel agent={mode} status={status} /><span>Fictional dataset · {connected ? 'real graph execution' : 'no execution confirmed'}</span></div><ErrorNotice error={error} onDismiss={() => setError(null)} />
      {busy === 'connect' ? <EmptyState eyebrow="Connecting locally" title="Getting the kitchen ready." busy><p>Checking FalkorDBLite and the local tool connection. No graph result has been assumed.</p></EmptyState> : !connected ? <EmptyState eyebrow="Connection required" title="The graph is not connected yet." action={<Action onClick={connect}>Reconnect locally</Action>}><p>Start the Kitchen Rescue server to investigate this fictional kitchen. It uses local FalkorDBLite; no Cloud account or billing is required.</p></EmptyState> : busy === 'investigate' ? <EmptyState eyebrow={`Investigating / ${depth} ${depth === 1 ? 'hop' : 'hops'}`} title="Follow the evidence." busy><p>Resolving the ingredient and querying the recorded dependency paths. Previous results are cleared while the new query runs.</p></EmptyState> : result?.status === 'unknown' ? <UnknownResult result={result} onReset={() => investigate(FIRST_QUESTION, 4)} /> : result ? <div className="investigation-layout"><Graph result={result} onExplore={() => investigate(currentQuestion || question, 4)} /><Finding result={result} onExplore={() => investigate(currentQuestion || question, 4)} onRecovery={reviewRecovery} busy={busy === 'recovery'} /></div> : <EmptyState eyebrow="No result to display" title="Ask the graph a question." action={<Action onClick={() => investigate(question, depth)} disabled={!question.trim()}>Run investigation</Action>}><p>No cached or simulated result is being substituted. Submit a question to inspect the recorded relationships.</p></EmptyState>}
      {result && !busy && <ToolTrace trace={result.trace} agent={result.agent} status={status} data={result} />}
    </>}
    {view !== 'investigate' && <ErrorNotice error={error} onDismiss={() => setError(null)} />}
    {view === 'recovery' && <RecoveryView proposal={proposal} busy={Boolean(busy)} onRetry={reviewRecovery} onBack={() => navigate('investigate')} confirmed={confirmed} setConfirmed={setConfirmed} onApprove={approve} status={status} />}
    {view === 'prep' && <PrepBoard state={state} receipt={receipt} loading={stateLoading} error={stateError} onReload={refreshState} onInvestigate={() => navigate('investigate')} />}
    {view === 'decisions' && <Decisions state={state} loading={stateLoading} error={stateError} onReload={refreshState} />}
  </main><footer className="app-footer"><span>Graph Hacks / Track 01</span><span>Savora Kitchen Rescue · fictional kitchen, real local records</span><button onClick={connect} disabled={Boolean(busy)} className="footer-refresh"><RefreshCw size={12} />Reconnect</button></footer></div>;
}

createRoot(document.getElementById('root')).render(<App />);
