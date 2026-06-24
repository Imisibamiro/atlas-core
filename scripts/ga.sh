#!/usr/bin/env bash
# gospel-alerts.sh
# Fetch Nigerian gospel music RSS feeds, find new items, output for Discord.
set -uo pipefail

STATE_FILE="data/gospel-alerts-state.txt"
NEW_ITEMS_FILE="/tmp/gospel-new-items.json"

SITES=(
  "GospelHotspot|https://gospelhotspot.net/feed/|rss"
  "GMusicPlus|https://www.gmusicplus.com/feed/|rss"
  "GospelMinds|https://gospelminds.com/feed/|rss"
  "SelahAfrik|https://selahafrik.com/feed/|rss"
  "PraiseWorldRadio|https://www.praiseworldradio.com/feed/|rss"
  "PraiseJamzBlog|https://praisejamzblog.com/feeds/posts/default|atom"
  "247GospelVibes|https://247gospelvibes.com/feed/|rss"
)

mkdir -p "$(dirname "$STATE_FILE")"
touch "$STATE_FILE"
> "$NEW_ITEMS_FILE"

fetch_feed() {
  local name="$1" url="$2" type="$3"
  
  local tmpfile=$(mktemp)
  set +e
  local http_code
  http_code=$(curl -sL --max-time 15 -o "$tmpfile" -w "%{http_code}" "$url" 2>/dev/null)
  local curl_rc=$?
  set -e
  
  if [ "$curl_rc" -ne 0 ] || [ "$http_code" != "200" ] || [ ! -s "$tmpfile" ]; then
    echo "  [${name}] SKIP HTTP ${http_code:-failed} (rc=$curl_rc)" >&2
    rm -f "$tmpfile"
    return
  fi
  
  if ! head -c 100 "$tmpfile" | grep -q '<?xml' 2>/dev/null; then
    echo "  [${name}] SKIP Not XML" >&2
    rm -f "$tmpfile"
    return
  fi
  
  # Use a Perl script file to avoid shell quoting nightmares
  perl_script=$(mktemp)
  cat > "$perl_script" << 'PERLEOF'
use strict;
use warnings;

my ($name, $type, $state_file, $new_file) = @ARGV;

# Load seen state
my %seen;
if (open(my $sf, "<", $state_file)) {
  while (<$sf>) { chomp; $seen{$_} = 1; }
  close($sf);
}

local $/;
my $xml = <STDIN>;
my $count = 0;
my $new_count = 0;

my $item_tag = ($type eq "atom") ? "entry" : "item";
my @blocks = $xml =~ /<$item_tag>(.*?)<\/$item_tag>/gs;

open(my $nf, ">>", $new_file) or die "Cannot open $new_file: $!";

for my $block (@blocks) {
  $count++;
  
  # Title
  my ($title) = $block =~ /<title[^>]*>(.*?)<\/title>/s;
  next unless defined $title && $title =~ /\S/;
  
  $title =~ s/<!\[CDATA\[|\]\]>//g;
  $title =~ s/&#8211;/-/g;
  $title =~ s/&#8217;/'"'"'/g;
  $title =~ s/&#8216;/'"'"'/g;
  $title =~ s/&#039;/'"'"'/g;
  $title =~ s/&#038;|&amp;/\&/g;
  $title =~ s/&lt;/</g;
  $title =~ s/&gt;/>/g;
  $title =~ s/&quot;/\"/g;
  $title =~ s/&#8220;/\"/g;
  $title =~ s/&#8221;/\"/g;
  $title =~ s/&#8212;/--/g;
  $title =~ s/\s+/ /g;
  $title =~ s/^\s+|\s+$//g;
  next unless length($title) > 0;
  
  # GUID for dedup
  my $guid = "";
  if ($type eq "atom") {
    if ($block =~ /<id>(.*?)<\/id>/s) { $guid = $1; }
  }
  if (!$guid && $block =~ /<guid[^>]*>(.*?)<\/guid>/s) { $guid = $1; }
  $guid =~ s/<!\[CDATA\[|\]\]>//g;
  $guid =~ s/^\s+|\s+$//g;
  
  # Link
  my $link = "";
  if ($type eq "atom") {
    # Atom: find <link rel="alternate" href="...">
    if ($block =~ /<link\s[^>]*\brel\s*=\s*["\x27]alternate["\x27][^>]*\bhref\s*=\s*["\x27]([^"\x27]+)["\x27]/s ||
        $block =~ /<link\s[^>]*\bhref\s*=\s*["\x27]([^"\x27]+)["\x27][^>]*\brel\s*=\s*["\x27]alternate["\x27]/s) {
      $link = $1;
    }
    # Fallback: any link with href
    if (!$link && $block =~ /<link\s[^>]*\bhref\s*=\s*["\x27]([^"\x27]+)["\x27]/s) {
      $link = $1;
    }
  } else {
    # RSS
    if ($block =~ /<link>(.*?)<\/link>/s) { $link = $1; }
    elsif ($block =~ /<link\s[^>]*\bhref\s*=\s*["\x27]([^"\x27]+)["\x27]/s) { $link = $1; }
  }
  if (!$link && $guid =~ m|^https?://|) { $link = $guid; }
  $link =~ s/^\s+|\s+$//g;
  # Use link as GUID fallback
  if (!$guid && $link) { $guid = $link; }
  if (!$guid) { $guid = "${name}-item-${count}"; }
  
  # Date
  my $date = "";
  if ($block =~ /<pubDate>(.*?)<\/pubDate>/s) { $date = $1; }
  elsif ($block =~ /<published>(.*?)<\/published>/s) { $date = $1; }
  elsif ($block =~ /<updated>(.*?)<\/updated>/s) { $date = $1; }
  $date =~ s/\s+/ /g;
  $date =~ s/^\s+|\s+$//g;
  $date =~ s/^(\d{4}-\d{2}-\d{2}).*/$1/;
  
  # Categories
  my @cats;
  while ($block =~ /<category[^>]*>(.*?)<\/category>/g) { push @cats, $1; }
  if (!@cats) {
    while ($block =~ /<category[^>]*\bterm\s*=\s*["\x27]([^"\x27]+)["\x27]/g) { push @cats, $1; }
  }
  @cats = map { s/<!\[CDATA\[|\]\]>//gr } @cats;
  
  # State key
  my $key = "${name}|${guid}";
  next if $seen{$key};
  
  # Categorize
  my $tl = lc($title);
  my $cl = lc(join(" ", @cats));
  my $label = "📢 News";
  
  if ($tl =~ /\bvideo\b|\bvisualiser\b|\bvisualizer\b/ || $cl =~ /\bvideo\b/) {
    $label = "🎬 Video";
  }
  if ($tl =~ /\bep\b|\balbum\b/ && $tl !~ /album.*download/i && $tl !~ /photo/) {
    $label = "💿 Album/EP";
  }
  if ($tl =~ /^\[?(music|audio|download|mp3)/ || $cl =~ /music|new music|audio music/) {
    $label = "🎵 New Music";
  }
  if ($tl =~ /mixtape|diamond sound/) {
    $label = "🎵 Mixtape";
  }
  if ($tl =~ /\bdevotional\b|daily.?manna|seed.?of.?destiny|rhapsody|wommack/ || $cl =~ /\bdevotional\b/) {
    $label = "📖 Devotional";
  }
  
  $new_count++;
  
  # Escape for JSON
  $title =~ s/\\/\\\\/g; $title =~ s/"/\\"/g;
  $link =~ s/\\/\\\\/g; $link =~ s/"/\\"/g;
  $date =~ s/\\/\\\\/g; $date =~ s/"/\\"/g;
  
  if (length($title) > 120) { $title = substr($title, 0, 117) . "..."; }
  
  print $nf "{\"source\":\"${name}\",\"title\":\"${title}\",\"link\":\"${link}\",\"date\":\"${date}\",\"type\":\"${label}\",\"guid\":\"${guid}\"}\n";
  
  # Mark seen
  $seen{$key} = 1;
  open(my $st, ">>", $state_file) or die "Cannot append $state_file: $!";
  print $st "${key}\n";
  close($st);
}

close($nf);
print STDERR "  [${name}] $count items, $new_count new\n";
PERLEOF

  perl "$perl_script" "$name" "$type" "$STATE_FILE" "$NEW_ITEMS_FILE" < "$tmpfile" 2>&1
  local perl_rc=$?
  rm -f "$perl_script" "$tmpfile"
  if [ "$perl_rc" -ne 0 ]; then
    echo "  [${name}] PARSE ERROR (rc=$perl_rc)" >&2
  fi
}

echo "=== Gospel Alerts Scraper ==="
echo "Fetching $(date -u '+%Y-%m-%d %H:%M UTC')"
echo ""

for site in "${SITES[@]}"; do
  IFS='|' read -r name url type <<< "$site"
  fetch_feed "$name" "$url" "$type"
done

NEW_COUNT=$(wc -l < "$NEW_ITEMS_FILE" 2>/dev/null || echo 0)
echo ""
echo "=== Done: ${NEW_COUNT} new items found ==="

if [ "$NEW_COUNT" -gt 0 ]; then
  cat "$NEW_ITEMS_FILE"
fi
