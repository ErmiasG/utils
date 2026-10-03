# CI run analysis — 3 October 2026

The likely persistent CI blocker is the OpenSearch snapshot-repository setup
Job, `create-repos-59f84cd1-r1`. It exhausted its retries. OpenSearch repeatedly
failed to verify `backup_default` because its S3 endpoint rejected batch-delete
requests without the required `Content-Md5` header.

The collected folder contains 1,044 files (87,781,245 bytes), including 348 empty
files. It contains cluster snapshots, events, resource descriptions, container
logs, and database logs. The Job descriptions show one terminal failed Job.

## Evidence and likely failure chain

1. The Job waits for OpenSearch and creates or updates the S3 repository
   `backup_default` in bucket `hopsfs`, under `opensearch_backup`. Its script
   uses `set -e` and `curl -f`, so an HTTP failure can terminate the container.
   [Job command](</home/ermias/Downloads/logs (1)/jobs/hopsworks/create-repos-59f84cd1-r1.txt:52>).
2. At 09:24:38 UTC, OpenSearch logs a failed delete batch. The nested S3
   exception says the request lacks `Content-Md5` and gives HTTP status 400.
   [S3 exception](</home/ermias/Downloads/logs (1)/pods/logs/hopsworks/opensearch-0/opensearch.log:3007>).
3. Repository verification cannot delete its test data. Seven verification
   failures occur between 09:24:38 and 09:30:20 UTC.
   [First verification failure](</home/ermias/Downloads/logs (1)/pods/logs/hopsworks/opensearch-0/opensearch.log:3123>),
   [last verification failure](</home/ermias/Downloads/logs (1)/pods/logs/hopsworks/opensearch-0/opensearch.log:4837>).
4. Kubernetes reports `BackoffLimitExceeded` for the setup Job. Its description
   records zero successful pods and one failed pod.
   [Terminal Job event](</home/ermias/Downloads/logs (1)/jobs/hopsworks/create-repos-59f84cd1-r1.txt:105>).

This strongly connects the failed Job to the S3 checksum rejection. The bundle
does not include the CI runner console or the deleted `create-repos` pod's
container log, so the exact CI command that returned failure cannot be confirmed
from these artifacts alone.

## Failures that recovered

- An Airflow migration attempt failed to recreate `task_reschedule` during
  conversion to NDB and reported fatal table-count mismatches. A later attempt
  succeeded, and the owning Job completed.
  [Failed attempt](</home/ermias/Downloads/logs (1)/pods/logs/hopsworks/migrate-airflow-5441d095-r1-5n469/migrate-airflow.log:102>),
  [completed Job](</home/ermias/Downloads/logs (1)/jobs/hopsworks/migrate-airflow-5441d095-r1.txt>).
- An image-preset pod failed with `REGISTRY NOT READY`; a later pod for the same
  indexed task completed. The image-preset Job also completed.
  [Failed container log](</home/ermias/Downloads/logs (1)/pods/logs/hopsworks/preset-images-4882ff30-r1-0-2-6sx5c/pushing-with-crane.log:1>),
  [replacement pod](</home/ermias/Downloads/logs (1)/pods.hopsworks.txt:127>),
  [owning Job](</home/ermias/Downloads/logs (1)/jobs/hopsworks/preset-images-4882ff30-r1-0.txt>).

There are also startup mount, probe, image-pull, and connection warnings. Their
presence alone does not establish the cause of CI failure; the final snapshots
show the main services running.

## Investigate next

Check the OpenSearch S3 client's batch-delete request and the storage endpoint's
checksum requirements. Reproduce verification of `backup_default`, confirm that
delete requests carry the required checksum, and rerun the repository-setup Job.
Capture the CI runner output and retain failed Job pod logs before cleanup to
confirm the final workflow failure.

Use the new **CI log explorer** at `?tool=ci`, choose **Open folder**, and select
`/home/ermias/Downloads/logs (1)`. The starting finding links the failed Job to
the checksum and repository-verification evidence. Search `Content-Md5`,
`backup_default`, or `BackoffLimitExceeded` and set **Evidence** to **Failures**
to exclude successful request headers and other ordinary text. Use **Recovered
attempts** to inspect the Airflow and image-preset history separately.
