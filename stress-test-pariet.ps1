<#
  Pariet Stress-Test Script (56 tabs)
  ------------------------------------
  Opens 56 realistic research URLs in Chrome sequentially.
  Run with the Pariet extension active and a research session started.

  Usage:
    .\stress-test-pariet.ps1
    .\stress-test-pariet.ps1 -DelaySeconds 3
#>

param(
  [int]$DelaySeconds = 2
)

$chromePath = "C:\Program Files\Google\Chrome\Application\chrome.exe"
if (-not (Test-Path $chromePath)) {
  $chromePath = "C:\Program Files (x86)\Google\Chrome\Application\chrome.exe"
}
if (-not (Test-Path $chromePath)) {
  Write-Host "Chrome not found. Set `$chromePath in the script." -ForegroundColor Red
  exit 1
}

# 56 URLs across 7 backend/distributed-systems topics
$urls = @(
  # --- Kafka (8) ---
  "https://www.google.com/search?q=apache+kafka+getting+started+guide"
  "https://kafka.apache.org/documentation/"
  "https://www.google.com/search?q=kafka+exactly+once+semantics+explained"
  "https://www.confluent.io/blog/kafka-fastest-messaging-system/"
  "https://github.com/confluentinc/confluent-kafka-python"
  "https://stackoverflow.com/questions/60413717/kafka-exactly-once-delivery-semantics"
  "https://kafka.apache.org/documentation/streams"
  "https://github.com/apache/kafka"

  # --- Redis (8) ---
  "https://www.google.com/search?q=redis+data+structures+explained"
  "https://redis.io/docs/getting-started/"
  "https://redis.io/docs/data-types/"
  "https://www.google.com/search?q=redis+persistence+RDB+vs+AOF"
  "https://github.com/redis/redis"
  "https://stackoverflow.com/questions/14591798/redis-persistence-explained"
  "https://redis.io/docs/management/scaling/"
  "https://redis.com/blog/redis-clustering-best-practices/"

  # --- PostgreSQL (8) ---
  "https://www.google.com/search?q=postgresql+indexing+best+practices"
  "https://www.postgresql.org/docs/current/tutorial.html"
  "https://www.postgresql.org/docs/current/indexes.html"
  "https://www.google.com/search?q=postgresql+query+optimization+explain+analyze"
  "https://github.com/postgres/postgres"
  "https://stackoverflow.com/questions/11522638/postgresql-query-optimization"
  "https://www.postgresql.org/docs/current/plpgsql.html"
  "https://hakibenita.com/postgresql-unused-index-size"

  # --- Docker (8) ---
  "https://www.google.com/search?q=docker+best+practices+dockerfile"
  "https://docs.docker.com/get-started/"
  "https://docs.docker.com/engine/reference/builder/"
  "https://www.google.com/search?q=docker+multi+stage+build+optimization"
  "https://github.com/moby/moby"
  "https://stackoverflow.com/questions/23677836/dockerfile-best-practices"
  "https://docs.docker.com/compose/"
  "https://www.docker.com/blog/docker-best-practices/"

  # --- Kubernetes (8) ---
  "https://www.google.com/search?q=kubernetes+architecture+explained"
  "https://kubernetes.io/docs/concepts/"
  "https://kubernetes.io/docs/concepts/services-networking/service/"
  "https://www.google.com/search?q=kubernetes+deployment+rolling+update+strategy"
  "https://github.com/kubernetes/kubernetes"
  "https://stackoverflow.com/questions/53285389/kubernetes-pod-scheduling-explained"
  "https://kubernetes.io/docs/concepts/workloads/controllers/deployment/"
  "https://kubernetes.io/blog/"

  # --- Java Concurrency (8) ---
  "https://www.google.com/search?q=java+virtual+threads+project+loom"
  "https://openjdk.org/projects/loom/"
  "https://docs.oracle.com/en/java/javase/21/docs/api/java.base/java/util/concurrent/package-summary.html"
  "https://www.google.com/search?q=java+CompletableFuture+chaining+examples"
  "https://github.com/openjdk/jdk"
  "https://stackoverflow.com/questions/38324942/java-virtual-threads-explained"
  "https://docs.oracle.com/en/java/javase/21/docs/api/java.base/java/util/concurrent/locks/ReentrantLock.html"
  "https://www.oracle.com/java/technologies/try-oracle-java.html"

  # --- Distributed Systems (8) ---
  "https://www.google.com/search?q=cap+theorem+explained+practical"
  "https://raft.github.io/"
  "https://www.google.com/search?q=raft+consensus+algorithm+explained"
  "https://github.com/etcd-io/etcd"
  "https://stackoverflow.com/questions/10683547/raft-consensus-algorithm-explained"
  "https://github.com/hashicorp/consul"
  "https://martinfowler.com/articles/data-monolith-to-microservices.html"
  "https://jepsen.io/analyses"
)

$totalUrls = $urls.Count

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  PARIET STRESS TEST (56 tabs)" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "  Total URLs : $totalUrls" -ForegroundColor White
Write-Host "  Delay      : ${DelaySeconds}s between URLs" -ForegroundColor White
Write-Host "  Est. time  : $([math]::Round($totalUrls * $DelaySeconds / 60, 1)) minutes" -ForegroundColor White
Write-Host ""
Write-Host "  1. Open Pariet at http://localhost:5173" -ForegroundColor Yellow
Write-Host "  2. Click 'Start Research' in the extension popup" -ForegroundColor Yellow
Write-Host "  3. Run this script" -ForegroundColor Yellow
Write-Host ""

$confirm = Read-Host "  Ready? (y/n)"
if ($confirm -ne "y") {
  Write-Host "  Aborted." -ForegroundColor Red
  exit 0
}

Write-Host ""
Write-Host "Starting stress test..." -ForegroundColor Green
Write-Host ""

for ($i = 0; $i -lt $urls.Count; $i++) {
  $num = $i + 1
  $padded = $num.ToString().PadLeft(2, '0')
  $url = $urls[$i]
  Write-Host "  [$padded/$totalUrls] $url" -ForegroundColor DarkGray
  Start-Process -FilePath $chromePath -ArgumentList $url
  Start-Sleep -Seconds $DelaySeconds
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Green
Write-Host "  STRESS TEST COMPLETE" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Green
Write-Host ""
Write-Host "  Opened $totalUrls tabs across 7 topics." -ForegroundColor White
Write-Host "  Topics: Kafka, Redis, PostgreSQL, Docker," -ForegroundColor White
Write-Host "          Kubernetes, Java Concurrency," -ForegroundColor White
Write-Host "          Distributed Systems" -ForegroundColor White
Write-Host ""
Write-Host "  Open Pariet to inspect the Research Map." -ForegroundColor Yellow
Write-Host ""
