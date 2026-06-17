FROM maven:3.9-eclipse-temurin-21 AS build

WORKDIR /app

COPY pom.xml .
COPY apps ./apps

RUN mvn -pl apps/user-service -am clean package spring-boot:repackage -DskipTests

RUN find apps/user-service/target -name "*.jar" ! -name "original-*.jar" -exec cp {} /tmp/app.jar \;

FROM eclipse-temurin:21-jre

WORKDIR /app

COPY --from=build /tmp/app.jar app.jar

EXPOSE 8082

ENTRYPOINT ["java", "-jar", "app.jar"]
